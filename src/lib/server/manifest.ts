import type { AssetRecord } from '../types.js';
import { UserFacingError } from './errors.js';

/**
 * The backup manifest.
 *
 * Field names deliberately match the manifest the Python CLI consumed, so a tree
 * produced here can still be fed to the old script and an older backup folder
 * remains readable. `version` is 2 because this generation records the show
 * title and the episode index, which the original did not.
 */
export interface ManifestAsset {
  kind: string;
  url: string;
  resolved_url: string | null;
  file: string;
  hosted_url: string | null;
  bytes: number | null;
  sha256: string | null;
  content_type: string | null;
  status: string;
}

export interface ManifestEpisode {
  guid: string | null;
  title: string | null;
  assets: ManifestAsset[];
}

export interface Manifest {
  version: number;
  generator: string;
  created: string;
  title: string | null;
  feed_url: string;
  hosted_feed_url: string;
  base_url: string;
  feeds: ManifestAsset[];
  assets: ManifestAsset[];
  episodes: ManifestEpisode[];
  /** Records which JPEGs were produced at which quality, so a re-run can skip them. */
  jpeg_processing: Record<string, { quality: number; sha256: string }>;
}

function toManifestAsset(asset: AssetRecord): ManifestAsset {
  return {
    kind: asset.kind,
    url: asset.sourceUrl,
    resolved_url: asset.resolvedUrl,
    file: asset.relativePath,
    hosted_url: asset.hostedUrl,
    bytes: asset.bytes,
    sha256: asset.sha256,
    content_type: asset.contentType,
    status: asset.status,
  };
}

export interface BuildManifestOptions {
  version: string;
  title: string | null;
  feedUrl: string;
  baseUrl: string;
  hostedFeedUrl: string;
  assets: AssetRecord[];
  episodeTitles: Map<string, string | null>;
  jpegProcessing: Record<string, { quality: number; sha256: string }>;
}

export function buildManifest(options: BuildManifestOptions): Manifest {
  const feeds: ManifestAsset[] = [];
  const channelAssets: ManifestAsset[] = [];
  const byEpisode = new Map<string, ManifestAsset[]>();

  for (const asset of options.assets) {
    const record = toManifestAsset(asset);
    if (asset.kind === 'feed') {
      feeds.push(record);
    } else if (asset.episodeGuid === null) {
      channelAssets.push(record);
    } else {
      const list = byEpisode.get(asset.episodeGuid) ?? [];
      list.push(record);
      byEpisode.set(asset.episodeGuid, list);
    }
  }

  const episodes: ManifestEpisode[] = [...byEpisode.entries()].map(([guid, assets]) => ({
    guid,
    title: options.episodeTitles.get(guid) ?? null,
    assets,
  }));

  return {
    version: 2,
    generator: `Podcast RSS Migrater ${options.version}`,
    created: new Date().toISOString(),
    title: options.title,
    feed_url: options.feedUrl,
    hosted_feed_url: options.hostedFeedUrl,
    base_url: options.baseUrl,
    feeds,
    assets: channelAssets,
    episodes,
    jpeg_processing: options.jpegProcessing,
  };
}

export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Reads a manifest produced by this app or by the Python CLI.
 *
 * The original raised a bare `KeyError: 'file'` for a record missing its path,
 * which surfaced to the user as `Error: 'file'`. Records are named here instead.
 */
export function readManifest(text: string): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UserFacingError('manifest.json is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UserFacingError('manifest.json must contain a JSON object.');
  }

  const manifest = parsed as Partial<Manifest>;
  const sections: [string, unknown][] = [
    ['feeds', manifest.feeds],
    ['assets', manifest.assets],
  ];

  for (const [name, section] of sections) {
    if (section === undefined) continue;
    if (!Array.isArray(section)) throw new UserFacingError(`manifest.json "${name}" must be a list.`);
    section.forEach((record, index) => {
      if (typeof record !== 'object' || record === null) {
        throw new UserFacingError(`manifest.json ${name}[${index}] is not an object.`);
      }
      if (typeof (record as ManifestAsset).file !== 'string') {
        throw new UserFacingError(`manifest.json ${name}[${index}] has no "file" field.`);
      }
    });
  }

  return {
    version: manifest.version ?? 1,
    generator: manifest.generator ?? 'unknown',
    created: manifest.created ?? '',
    title: manifest.title ?? null,
    feed_url: manifest.feed_url ?? '',
    hosted_feed_url: manifest.hosted_feed_url ?? '',
    base_url: manifest.base_url ?? '',
    feeds: manifest.feeds ?? [],
    assets: manifest.assets ?? [],
    episodes: manifest.episodes ?? [],
    jpeg_processing: manifest.jpeg_processing ?? {},
  };
}

/**
 * True when a previous run already produced this JPEG at this quality.
 *
 * Ported from the Python so that re-running a job at the same quality does not
 * recompress artwork -- JPEG encoding is lossy, and each pass costs quality.
 */
export function alreadyProcessed(
  jpegProcessing: Record<string, { quality: number; sha256: string }>,
  relativePath: string,
  quality: number,
  currentSha: string,
): boolean {
  const prior = jpegProcessing[relativePath];
  return prior !== undefined && prior.quality === quality && prior.sha256 === currentSha;
}
