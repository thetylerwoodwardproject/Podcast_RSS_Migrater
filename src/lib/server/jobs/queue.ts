import type { AssetRecord, LogLine, MigrationJob, ServerEvent } from '../../types.js';
import type { SftpCredentials } from '../deliver/sftp.js';

/**
 * A job as the server knows it.
 *
 * The extra fields never leave this process: routes and the event stream return
 * `toPublicJob()` output, so the browser sees relative paths and opaque ids but
 * never a filesystem path, the URL map, the feed bodies or SFTP credentials.
 */
export interface InternalJob extends MigrationJob {
  workspacePath: string;
  assets: Map<string, AssetRecord>;
  urlMap: Map<string, string>;
  feedBefore: string | null;
  feedAfter: string | null;
  /** Ring buffer of user-visible progress lines. */
  log: LogLine[];
  sftp: SftpCredentials | null;
  abort: AbortController;
}

const LOG_LIMIT = 500;

interface Store {
  jobs: Map<string, InternalJob>;
  listeners: Set<(event: ServerEvent) => void>;
}

/**
 * State is anchored on `globalThis` rather than in module scope.
 *
 * Under adapter-node the module is evaluated once and plain module state would be
 * fine, but Vite's dev server re-evaluates SSR modules on edit. Without this, a
 * hot reload would silently swap in an empty Map and orphan whatever job was
 * mid-download, which is a confusing failure to debug.
 */
const STORE_KEY = Symbol.for('migrater.queue');

const store: Store = ((globalThis as Record<symbol, unknown>)[STORE_KEY] ??= {
  jobs: new Map<string, InternalJob>(),
  listeners: new Set<(event: ServerEvent) => void>(),
}) as Store;

export function toPublicJob(job: InternalJob): MigrationJob {
  const { workspacePath, assets, urlMap, feedBefore, feedAfter, log, sftp, abort, ...publicFields } = job;
  return publicFields;
}

export function subscribe(listener: (event: ServerEvent) => void): () => void {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

export function subscriberCount(): number {
  return store.listeners.size;
}

export function emit(event: ServerEvent): void {
  for (const listener of store.listeners) {
    try {
      listener(event);
    } catch {
      // One dead stream must not stop the others from being told.
    }
  }
}

export function addJob(job: InternalJob): void {
  store.jobs.set(job.id, job);
  emit({ type: 'job:update', job: toPublicJob(job) });
}

export function getJob(id: string): InternalJob | undefined {
  return store.jobs.get(id);
}

export function listJobs(): InternalJob[] {
  return [...store.jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function deleteJob(id: string): InternalJob | undefined {
  const existing = store.jobs.get(id);
  if (!existing) return undefined;
  store.jobs.delete(id);
  emit({ type: 'job:remove', jobId: id });
  return existing;
}

/**
 * Applies a change and tells every listener.
 *
 * Mutating in place rather than replacing the record keeps the `assets` Map and
 * the AbortController identity stable for whatever is holding a reference.
 */
export function updateJob(id: string, patch: Partial<MigrationJob>): InternalJob | undefined {
  const job = store.jobs.get(id);
  if (!job) return undefined;

  Object.assign(job, patch, { updatedAt: Date.now() });
  emit({ type: 'job:update', job: toPublicJob(job) });
  return job;
}

/** Updates without emitting, for callers batching several changes into one event. */
export function patchJobQuietly(id: string, patch: Partial<MigrationJob>): InternalJob | undefined {
  const job = store.jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, patch, { updatedAt: Date.now() });
  return job;
}

export function publishJob(id: string): void {
  const job = store.jobs.get(id);
  if (job) emit({ type: 'job:update', job: toPublicJob(job) });
}

export function setAsset(jobId: string, asset: AssetRecord): void {
  const job = store.jobs.get(jobId);
  if (!job) return;
  job.assets.set(asset.id, asset);
}

/**
 * Emits a batch of asset changes.
 *
 * Asset events are batched rather than sent per file: a long back catalogue can
 * hold thousands of assets, and one frame each would swamp the stream. Byte-level
 * progress rides on the job's own progress counters instead.
 */
export function emitAssets(jobId: string, assets: AssetRecord[]): void {
  if (assets.length === 0) return;
  emit({ type: 'asset:update', jobId, assets });
}

export function appendLog(jobId: string, level: LogLine['level'], message: string): void {
  const job = store.jobs.get(jobId);
  if (!job) return;

  const line: LogLine = { at: Date.now(), level, message };
  job.log.push(line);
  if (job.log.length > LOG_LIMIT) job.log.splice(0, job.log.length - LOG_LIMIT);
  emit({ type: 'job:log', jobId, line });
}

export function snapshot(): MigrationJob[] {
  return listJobs().map(toPublicJob);
}

/** Test seam: empties the store without touching the filesystem. */
export function resetQueueForTests(): void {
  store.jobs.clear();
  store.listeners.clear();
}
