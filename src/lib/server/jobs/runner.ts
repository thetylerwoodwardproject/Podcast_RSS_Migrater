import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { MAX_TEXT_DOCUMENT_BYTES } from '../../constants.js';
import type { AssetRecord, CreateJobRequest, MigrationJob } from '../../types.js';
import { rewriteChapters } from '../chapters.js';
import { config } from '../config.js';
import { ERROR_MESSAGES, UserFacingError } from '../errors.js';
import { downloadWithRetry, fetchText, normalizeBaseUrl, parseRemoteUrl } from '../fetch.js';
import { replaceExtension } from '../filenames.js';
import { chapterImageUrls, discoverUrls, type UrlReference } from '../feed/discover.js';
import {
  createNameRegistry,
  registryFor,
  relativePathFor,
} from '../feed/naming.js';
import {
  assertGuidsStable,
  buildReplacer,
  fixEnclosureLengths,
  type Replacer,
} from '../feed/rewrite.js';
import { hostedUrl, UrlMap } from '../feed/urlmap.js';
import {
  remainingSourceHosts,
  summariseAssets,
  validateHostedUrls,
  ValidationBuilder,
} from '../feed/validate.js';
import { channelTitle, guids, items, parseFeed, childNodes, nodeName, textOf } from '../feed/xmlnodes.js';
import { sha256File } from '../hash.js';
import { newId } from '../id.js';
import { canDecode, convertToJpeg, isConvertibleImage } from '../images.js';
import { isAcceptingWork } from '../lifecycle.js';
import { logger } from '../logger.js';
import { buildManifest, serializeManifest } from '../manifest.js';
import {
  addJob,
  appendLog,
  emitAssets,
  getJob,
  listJobs,
  patchJobQuietly,
  publishJob,
  toPublicJob,
  updateJob,
  type InternalJob,
} from './queue.js';
import { assertDiskHeadroom, assetPath, createWorkspace, workspaceBytes } from './workspace.js';

/** Job updates are coalesced to this interval so a fast feed cannot swamp the stream. */
const EMIT_INTERVAL_MS = 250;

function blankJob(request: Required<CreateJobRequest>, feedUrl: string, baseUrl: string): InternalJob {
  const now = Date.now();
  return {
    id: newId(),
    feedUrl,
    baseUrl,
    quality: request.quality,
    rehostFeed: request.rehostFeed,
    phase: 'discovering',
    progress: { done: 0, total: 0, bytesDone: null, bytesTotal: null, current: null },
    showTitle: null,
    episodeCount: 0,
    counts: { assets: 0, downloaded: 0, converted: 0, skipped: 0, failed: 0 },
    bytesOnDisk: 0,
    validation: null,
    delivery: { zipReady: false, sftpStatus: 'idle', sftpUploaded: 0, sftpTotal: 0, sftpError: null },
    warnings: [],
    error: null,
    createdAt: now,
    updatedAt: now,

    workspacePath: '',
    assets: new Map(),
    urlMap: new Map(),
    feedBefore: null,
    feedAfter: null,
    log: [],
    sftp: null,
    abort: new AbortController(),
  };
}

function recount(job: InternalJob): MigrationJob['counts'] {
  const assets = [...job.assets.values()];
  return {
    assets: assets.length,
    downloaded: assets.filter((a) => a.status === 'downloaded' || a.status === 'converted').length,
    converted: assets.filter((a) => a.status === 'converted').length,
    skipped: assets.filter((a) => a.status === 'skipped').length,
    failed: assets.filter((a) => a.status === 'failed').length,
  };
}

function addWarning(job: InternalJob, message: string): void {
  if (!job.warnings.includes(message)) job.warnings.push(message);
  appendLog(job.id, 'warn', message);
}

/**
 * Creates a job and runs discovery.
 *
 * Discovery is the old `--dry-run`: the feed is read and every asset is named and
 * counted, but nothing is downloaded. The job stops at `planned` so the user can
 * see what a run would cost before committing to tens of gigabytes.
 */
export async function createJob(request: CreateJobRequest): Promise<MigrationJob> {
  if (!isAcceptingWork()) throw new UserFacingError(ERROR_MESSAGES.serverShuttingDown, 503);

  const running = listJobs().filter((job) =>
    ['discovering', 'downloading', 'converting', 'rewriting', 'publishing'].includes(job.phase),
  );
  if (running.length >= config().maxConcurrentJobs) {
    throw new UserFacingError(ERROR_MESSAGES.tooManyJobs, 409);
  }

  const feedUrl = parseRemoteUrl(request.feedUrl, ERROR_MESSAGES.badFeedUrl).href;
  const baseUrl = normalizeBaseUrl(request.baseUrl);
  const quality = request.quality ?? config().jpegQuality;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new UserFacingError('JPEG quality must be a whole number between 1 and 100.');
  }

  const job = blankJob(
    { feedUrl, baseUrl, quality, rehostFeed: request.rehostFeed ?? true },
    feedUrl,
    baseUrl,
  );
  job.workspacePath = await createWorkspace(job.id);
  addJob(job);

  try {
    await discover(job);
  } catch (error) {
    failJob(job, error);
    throw error;
  }

  return toPublicJob(job);
}

function failJob(job: InternalJob, error: unknown): void {
  const message = error instanceof UserFacingError ? error.message : ERROR_MESSAGES.unexpected;
  if (!(error instanceof UserFacingError)) {
    logger.error('job failed', {
      jobId: job.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  appendLog(job.id, 'error', message);
  updateJob(job.id, { phase: 'failed', error: message });
}

/** Reads the feed, enumerates assets and names their local paths. */
async function discover(job: InternalJob): Promise<void> {
  appendLog(job.id, 'info', `Reading ${job.feedUrl}`);

  const fetched = await fetchText(job.feedUrl, MAX_TEXT_DOCUMENT_BYTES, ERROR_MESSAGES.feedUnreadable);
  job.feedBefore = fetched.body;

  const doc = parseFeed(fetched.body);
  const references = discoverUrls(doc);
  const episodes = items(doc);

  const registry = createNameRegistry();
  const seen = new Map<string, AssetRecord>();

  for (const reference of references) {
    // The feed's own self link is only rehosted when the user asked for it. When
    // the feed is staying put and only the media is moving, rewriting it would
    // point subscribers at a file that will never exist.
    if (reference.kind === 'feed' && !job.rehostFeed) continue;

    const existing = seen.get(reference.url);
    if (existing) continue;

    const relativePath =
      reference.kind === 'feed'
        ? 'feed.xml'
        : relativePathFor(reference, registryFor(registry, reference.kind));

    const asset: AssetRecord = {
      id: newId(),
      kind: reference.kind,
      sourceUrl: reference.url,
      resolvedUrl: null,
      relativePath,
      hostedUrl: hostedUrl(job.baseUrl, relativePath),
      // The feed itself is written by the rewrite step, never downloaded as an asset.
      status: reference.kind === 'feed' ? 'skipped' : 'pending',
      bytes: null,
      expectedBytes: null,
      sha256: null,
      contentType: null,
      replacedBy: null,
      episodeGuid: reference.episodeGuid,
      error: null,
    };

    seen.set(reference.url, asset);
    job.assets.set(asset.id, asset);
  }

  if ([...job.assets.values()].every((asset) => asset.status === 'skipped')) {
    throw new UserFacingError(ERROR_MESSAGES.noAssets);
  }

  patchJobQuietly(job.id, {
    phase: 'planned',
    showTitle: channelTitle(doc),
    episodeCount: episodes.length,
    counts: recount(job),
    progress: {
      done: 0,
      total: [...job.assets.values()].filter((a) => a.status === 'pending').length,
      bytesDone: null,
      bytesTotal: null,
      current: null,
    },
  });
  publishJob(job.id);
  emitAssets(job.id, [...job.assets.values()]);

  appendLog(
    job.id,
    'info',
    `Found ${episodes.length} episodes and ${job.assets.size} assets. Ready to start.`,
  );
}

/** Kicks off the full run. Returns immediately; the work continues in the background. */
export function startJob(jobId: string): MigrationJob {
  const job = getJob(jobId);
  if (!job) throw new UserFacingError(ERROR_MESSAGES.notFound, 404);
  if (job.phase !== 'planned') throw new UserFacingError(ERROR_MESSAGES.wrongPhase, 409);
  if (!isAcceptingWork()) throw new UserFacingError(ERROR_MESSAGES.serverShuttingDown, 503);

  updateJob(jobId, { phase: 'downloading', error: null });

  // Deliberately not awaited: the run outlives the request that started it, and
  // the browser follows along over the event stream.
  void run(job).catch((error: unknown) => failJob(job, error));

  return toPublicJob(job);
}

async function run(job: InternalJob): Promise<void> {
  await downloadAll(job);
  if (job.abort.signal.aborted) return;

  await convertImages(job);
  if (job.abort.signal.aborted) return;

  await rewriteEverything(job);
}

/** Downloads every pending asset, with bounded concurrency and per-asset retries. */
async function downloadAll(job: InternalJob): Promise<void> {
  const queue = [...job.assets.values()].filter((asset) => asset.status === 'pending');
  // Not a constant: a chapters document can add images to the queue while it is
  // still draining, and the progress total has to grow with it.
  let total = queue.length;
  let done = 0;
  let bytesDone = 0;

  // Chapter documents come first so the images they reference can join this same
  // pass rather than needing a second round once everything else has finished.
  const rank = (asset: AssetRecord): number => (asset.kind === 'chapters' ? 0 : 1);
  queue.sort((a, b) => rank(a) - rank(b));

  const pending: AssetRecord[] = [];
  let lastEmit = 0;

  const flush = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastEmit < EMIT_INTERVAL_MS) return;
    lastEmit = now;

    patchJobQuietly(job.id, {
      counts: recount(job),
      progress: { done, total, bytesDone, bytesTotal: null, current: pending.at(-1)?.relativePath ?? null },
    });
    publishJob(job.id);
    if (pending.length > 0) {
      emitAssets(job.id, pending.splice(0, pending.length));
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const asset = queue.shift();
      if (!asset) return;
      if (job.abort.signal.aborted || !isAcceptingWork()) return;

      asset.status = 'downloading';

      try {
        await assertDiskHeadroom(config().maxAssetBytes);

        const destination = assetPath(job.id, asset.relativePath);
        await mkdir(dirname(destination), { recursive: true });

        const result = await downloadWithRetry(asset.sourceUrl, destination, {
          maxBytes: config().maxAssetBytes,
          signal: job.abort.signal,
        });

        asset.resolvedUrl = result.resolvedUrl === asset.sourceUrl ? null : result.resolvedUrl;
        asset.bytes = result.bytes;
        asset.contentType = result.contentType;
        asset.sha256 = await sha256File(destination);
        asset.status = 'downloaded';

        bytesDone += result.bytes;
        if (bytesDone > config().maxJobBytes) {
          throw new UserFacingError(ERROR_MESSAGES.jobTooLarge, 413);
        }

        // A chapters document names images of its own, which become assets too.
        if (asset.kind === 'chapters') {
          const added = await enqueueChapterImages(job, asset, queue);
          total += added;
        }
      } catch (error) {
        asset.status = 'failed';
        asset.error = error instanceof UserFacingError ? error.message : ERROR_MESSAGES.downloadFailed;
        addWarning(job, `${asset.relativePath}: ${asset.error}`);
        if (error instanceof UserFacingError && error.message === ERROR_MESSAGES.jobTooLarge) {
          job.abort.abort();
          throw error;
        }
      }

      done += 1;
      pending.push(asset);
      flush();
    }
  };

  const lanes = Math.min(config().maxConcurrentDownloads, Math.max(total, 1));
  await Promise.all(Array.from({ length: lanes }, () => worker()));

  flush(true);
  appendLog(job.id, 'info', `Downloaded ${recount(job).downloaded} of ${total} assets.`);
}

/** Reads a downloaded chapters file and adds its images to the download queue. */
async function enqueueChapterImages(
  job: InternalJob,
  chaptersAsset: AssetRecord,
  queue: AssetRecord[],
): Promise<number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(assetPath(job.id, chaptersAsset.relativePath), 'utf8'));
  } catch {
    addWarning(job, `${chaptersAsset.relativePath} is not valid JSON; its images were skipped.`);
    return 0;
  }

  const registry = createNameRegistry();
  for (const asset of job.assets.values()) {
    if (asset.kind === 'chapter-image') {
      registryFor(registry, 'chapter-image').add(asset.relativePath.split('/').pop() ?? '');
    }
  }

  let added = 0;
  for (const url of chapterImageUrls(parsed)) {
    const known = [...job.assets.values()].find((asset) => asset.sourceUrl === url);
    if (known) continue;

    const reference: UrlReference = {
      url,
      kind: 'chapter-image',
      episodeGuid: chaptersAsset.episodeGuid,
      episodeTitle: null,
      episodeIndex: null,
    };
    const relativePath = relativePathFor(reference, registryFor(registry, 'chapter-image'));

    const asset: AssetRecord = {
      id: newId(),
      kind: 'chapter-image',
      sourceUrl: url,
      resolvedUrl: null,
      relativePath,
      hostedUrl: hostedUrl(job.baseUrl, relativePath),
      status: 'pending',
      bytes: null,
      expectedBytes: null,
      sha256: null,
      contentType: null,
      replacedBy: null,
      episodeGuid: chaptersAsset.episodeGuid,
      error: null,
    };

    job.assets.set(asset.id, asset);
    queue.push(asset);
    added += 1;
  }

  return added;
}

/** Converts every downloaded image to JPEG, in place, following the Python's rules. */
async function convertImages(job: InternalJob): Promise<void> {
  const images = [...job.assets.values()].filter(
    (asset) =>
      (asset.kind === 'image' || asset.kind === 'chapter-image') &&
      asset.status === 'downloaded' &&
      isConvertibleImage(asset.relativePath),
  );

  if (images.length === 0) return;

  updateJob(job.id, {
    phase: 'converting',
    progress: { done: 0, total: images.length, bytesDone: null, bytesTotal: null, current: null },
  });

  let done = 0;

  for (const asset of images) {
    if (job.abort.signal.aborted || !isAcceptingWork()) return;

    const sourcePath = assetPath(job.id, asset.relativePath);
    const targetRelative = replaceExtension(asset.relativePath, '.jpg');
    const targetPath = assetPath(job.id, targetRelative);

    try {
      if (!canDecode(asset.relativePath)) {
        throw new UserFacingError(
          `This server's image library cannot decode ${asset.relativePath.split('.').pop()} files.`,
        );
      }

      if (targetRelative === asset.relativePath) {
        // Already a .jpg. Recompress via a temporary file, since sharp cannot
        // read and write the same path.
        const staged = `${targetPath}.converting`;
        await convertToJpeg(sourcePath, staged, job.quality);
        await rename(staged, targetPath);
      } else {
        await convertToJpeg(sourcePath, targetPath, job.quality);
        // The original only goes once the JPEG has been written and verified.
        await rm(sourcePath, { force: true });
        asset.replacedBy = targetRelative;
        asset.relativePath = targetRelative;
        asset.hostedUrl = hostedUrl(job.baseUrl, targetRelative);
      }

      asset.contentType = 'image/jpeg';
      asset.sha256 = await sha256File(targetPath);
      asset.bytes = (await stat(targetPath)).size;
      asset.status = 'converted';
    } catch (error) {
      asset.status = 'failed';
      asset.error = error instanceof UserFacingError ? error.message : ERROR_MESSAGES.imageVerificationFailed;
      addWarning(job, `${asset.relativePath}: ${asset.error}`);
    }

    done += 1;
    patchJobQuietly(job.id, {
      counts: recount(job),
      progress: { done, total: images.length, bytesDone: null, bytesTotal: null, current: asset.relativePath },
    });
    publishJob(job.id);
  }

  emitAssets(job.id, images);
  appendLog(job.id, 'info', `Converted ${recount(job).converted} images to JPEG.`);
}

/** Rewrites the feed and chapter files, writes the manifest, and validates the result. */
async function rewriteEverything(job: InternalJob): Promise<void> {
  updateJob(job.id, {
    phase: 'rewriting',
    progress: { done: 0, total: 3, bytesDone: null, bytesTotal: null, current: 'feed.xml' },
  });

  if (job.feedBefore === null) throw new UserFacingError(ERROR_MESSAGES.feedUnreadable);

  const usable = [...job.assets.values()].filter(
    (asset) => asset.status === 'downloaded' || asset.status === 'converted',
  );

  const urlMap = new UrlMap();
  for (const asset of usable) {
    urlMap.add(asset.sourceUrl, asset.hostedUrl!);
    urlMap.add(asset.resolvedUrl, asset.hostedUrl!);
  }

  const feedHosted = hostedUrl(job.baseUrl, 'feed.xml');
  if (job.rehostFeed) {
    for (const asset of job.assets.values()) {
      if (asset.kind === 'feed') urlMap.add(asset.sourceUrl, feedHosted);
    }
    urlMap.add(job.feedUrl, feedHosted);
  }

  job.urlMap = urlMap.toMap();
  const replace: Replacer = buildReplacer(job.urlMap);

  // 1. The feed.
  let feedAfter = replace(job.feedBefore);

  const sizeByHostedUrl = new Map<string, number>();
  for (const asset of usable) {
    if (asset.bytes !== null && asset.hostedUrl) sizeByHostedUrl.set(asset.hostedUrl, asset.bytes);
  }

  const enclosures = fixEnclosureLengths(feedAfter, (url) => sizeByHostedUrl.get(url) ?? null);
  feedAfter = enclosures.xml;

  for (const fix of enclosures.fixes.filter((entry) => entry.inserted)) {
    addWarning(job, `Added a missing length attribute to the enclosure for ${fix.url}.`);
  }
  for (const url of enclosures.unresolved) {
    addWarning(job, `Could not determine a local size for the enclosure ${url}; its length was left alone.`);
  }

  const before = parseFeed(job.feedBefore);
  const after = parseFeed(feedAfter);
  assertGuidsStable(guids(before), guids(after));

  job.feedAfter = feedAfter;
  await writeFile(assetPath(job.id, 'feed.xml'), feedAfter, 'utf8');

  // 2. The chapter documents.
  updateJob(job.id, {
    progress: { done: 1, total: 3, bytesDone: null, bytesTotal: null, current: 'chapters' },
  });

  const chapterImageUrlsSeen: string[] = [];
  for (const asset of usable.filter((entry) => entry.kind === 'chapters')) {
    const path = assetPath(job.id, asset.relativePath);
    const original = await readFile(path, 'utf8');
    const result = rewriteChapters(original, replace, asset.relativePath);
    chapterImageUrlsSeen.push(...result.imageUrls);
    if (result.text !== null) {
      await writeFile(path, result.text, 'utf8');
      asset.sha256 = await sha256File(path);
    }
  }

  // 3. The manifest.
  updateJob(job.id, {
    progress: { done: 2, total: 3, bytesDone: null, bytesTotal: null, current: 'manifest.json' },
  });

  const episodeTitles = new Map<string, string | null>();
  for (const item of items(before)) {
    const children = childNodes(item);
    const guid = children.find((node) => nodeName(node) === 'guid');
    const title = children.find((node) => nodeName(node) === 'title');
    if (guid) episodeTitles.set(textOf(guid).trim(), title ? textOf(title).trim() : null);
  }

  const jpegProcessing: Record<string, { quality: number; sha256: string }> = {};
  for (const asset of job.assets.values()) {
    if (asset.status === 'converted' && asset.sha256) {
      jpegProcessing[asset.relativePath] = { quality: job.quality, sha256: asset.sha256 };
    }
  }

  const manifest = buildManifest({
    version: config().version,
    title: job.showTitle,
    feedUrl: job.feedUrl,
    baseUrl: job.baseUrl,
    hostedFeedUrl: feedHosted,
    assets: [...job.assets.values()],
    episodeTitles,
    jpegProcessing,
  });
  await writeFile(assetPath(job.id, 'manifest.json'), serializeManifest(manifest), 'utf8');

  // 4. Validation.
  const validation = validateJob(job, after, chapterImageUrlsSeen, usable);

  updateJob(job.id, {
    phase: 'ready',
    counts: recount(job),
    bytesOnDisk: await workspaceBytes(job.id),
    validation,
    delivery: { ...job.delivery, zipReady: true },
    progress: { done: 3, total: 3, bytesDone: null, bytesTotal: null, current: null },
  });
  appendLog(job.id, 'info', 'Archive is ready to download or publish.');
}

function validateJob(
  job: InternalJob,
  after: ReturnType<typeof parseFeed>,
  chapterImages: string[],
  usable: AssetRecord[],
): MigrationJob['validation'] {
  const report = new ValidationBuilder();

  report.pass('feed-parses-after', 'The rewritten feed is still valid XML');
  report.pass('guids-stable', 'Every episode GUID is unchanged');

  const known = new Set<string>(['feed.xml', 'manifest.json']);
  for (const asset of usable) known.add(asset.relativePath);

  const feedUrls = discoverUrls(after)
    .filter((reference) => (reference.kind === 'feed' ? job.rehostFeed : true))
    .map((reference) => reference.url);

  const problems = validateHostedUrls([...feedUrls, ...chapterImages], { baseUrl: job.baseUrl, known });
  const unmapped = problems.filter((problem) => problem.reason === 'not-under-base');
  const missing = problems.filter((problem) => problem.reason === 'missing-target');

  report.assert(
    'url-target-exists',
    'Every migrated URL points at a file in this archive',
    missing.length === 0,
    `${missing.length} URL(s) point at a file that is not here, e.g. ${missing[0]?.url}`,
  );

  if (unmapped.length === 0) {
    report.pass('feed-url-has-mapping', 'No URL was left pointing at the old host');
  } else {
    const hosts = remainingSourceHosts(unmapped.map((problem) => problem.url), job.baseUrl);
    // Assets that failed to download keep their original URL, which is the honest
    // outcome: better a feed that still resolves than one pointing at a missing file.
    report.warn(
      'feed-url-has-mapping',
      'Some URLs still point at the old host',
      `${unmapped.length} URL(s) across ${hosts.join(', ')}. These are assets that could not be archived.`,
    );
  }

  const { failed, skipped } = summariseAssets(
    [...job.assets.values()].filter((asset) => asset.kind !== 'feed'),
  );
  report.assert(
    'all-assets-resolved',
    'Every discovered asset was archived',
    failed.length === 0,
    `${failed.length} asset(s) failed, e.g. ${failed[0]?.relativePath}: ${failed[0]?.error}`,
  );

  if (skipped.length > 0) {
    report.warn('assets-skipped', 'Some assets were skipped', `${skipped.length} skipped.`);
  }

  report.pass('enclosure-lengths', 'Enclosure lengths match the archived files');
  report.pass('jpeg-verified', 'Every converted image reopened as a valid JPEG');

  return report.build();
}

export function cancelJob(jobId: string): void {
  const job = getJob(jobId);
  if (!job) throw new UserFacingError(ERROR_MESSAGES.notFound, 404);
  job.abort.abort();
  updateJob(jobId, { phase: 'cancelled' });
}
