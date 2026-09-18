/**
 * Types shared by the server and the browser.
 *
 * Server-only types live in `$lib/server/*`. Nothing in here may reference a
 * filesystem path or a credential: everything defined here is serialized into
 * responses and into the event stream.
 */

export const JOB_PHASES = [
  'discovering',
  'planned',
  'downloading',
  'converting',
  'rewriting',
  'ready',
  'publishing',
  'complete',
  'failed',
  'cancelled',
] as const;
export type JobPhase = (typeof JOB_PHASES)[number];

/** Phases from which no further work happens without a new request. */
export const TERMINAL_PHASES: ReadonlySet<JobPhase> = new Set<JobPhase>([
  'complete',
  'failed',
  'cancelled',
]);

/** Phases where the server is actively working, so the UI shows a spinner. */
export const ACTIVE_PHASES: ReadonlySet<JobPhase> = new Set<JobPhase>([
  'discovering',
  'downloading',
  'converting',
  'rewriting',
  'publishing',
]);

export const ASSET_KINDS = ['audio', 'image', 'chapter-image', 'chapters', 'transcript', 'feed'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_STATUSES = [
  'pending',
  'downloading',
  'downloaded',
  'converted',
  'skipped',
  'failed',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  /** Where the source feed pointed. Never rewritten: this is the migration key. */
  sourceUrl: string;
  /** The URL that actually served the bytes, when redirects moved it. */
  resolvedUrl: string | null;
  /** POSIX path relative to the archive root, e.g. "audio/ep041.mp3". Never absolute. */
  relativePath: string;
  /** Where the migrated feed will point. */
  hostedUrl: string | null;
  status: AssetStatus;
  bytes: number | null;
  /** Content-Length seen during discovery, so the plan can estimate the total. */
  expectedBytes: number | null;
  sha256: string | null;
  contentType: string | null;
  /** For a non-JPEG image, the .jpg path that replaced it. */
  replacedBy: string | null;
  /** The owning episode's GUID, or null for channel-level assets. */
  episodeGuid: string | null;
  error: string | null;
}

export interface PhaseProgress {
  done: number;
  total: number;
  /** Populated while downloading and publishing, null otherwise. */
  bytesDone: number | null;
  bytesTotal: number | null;
  /** What is being worked on right now, e.g. "audio/ep041.mp3". */
  current: string | null;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string | null;
}

export interface ValidationReport {
  checks: CheckResult[];
  passed: number;
  warned: number;
  failed: number;
  ranAt: number;
}

export interface DeliveryState {
  zipReady: boolean;
  sftpStatus: 'idle' | 'running' | 'complete' | 'failed';
  sftpUploaded: number;
  sftpTotal: number;
  sftpError: string | null;
}

export interface JobCounts {
  assets: number;
  downloaded: number;
  converted: number;
  skipped: number;
  failed: number;
}

export interface MigrationJob {
  id: string;
  feedUrl: string;
  baseUrl: string;
  quality: number;
  /** When false, the feed's own atom:link rel="self" is left pointing at the old host. */
  rehostFeed: boolean;
  phase: JobPhase;
  progress: PhaseProgress;
  /** The channel title, once the feed has been read. */
  showTitle: string | null;
  episodeCount: number;
  counts: JobCounts;
  bytesOnDisk: number;
  validation: ValidationReport | null;
  delivery: DeliveryState;
  warnings: string[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LogLine {
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type ServerEvent =
  | { type: 'snapshot'; jobs: MigrationJob[] }
  | { type: 'job:update'; job: MigrationJob }
  | { type: 'job:remove'; jobId: string }
  | { type: 'asset:update'; jobId: string; assets: AssetRecord[] }
  | { type: 'job:log'; jobId: string; line: LogLine };

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  /** Image formats this server's libvips build can actually decode. */
  imageFormats: string[];
  diskFreeBytes: number | null;
  acceptingWork: boolean;
}

export interface CreateJobRequest {
  feedUrl: string;
  baseUrl: string;
  quality?: number;
  rehostFeed?: boolean;
}

export interface SftpRequest {
  host: string;
  port?: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  remotePath?: string;
}

/** Non-secret SFTP defaults from the environment, used to prefill the publish form. */
export interface SftpDefaults {
  host: string;
  port: number;
  username: string;
  remotePath: string;
}

export interface ApiError {
  error: string;
}
