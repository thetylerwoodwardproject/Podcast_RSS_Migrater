import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  dataPath: string;
  defaultBaseUrl: string;
  jpegQuality: number;
  maxConcurrentJobs: number;
  maxConcurrentDownloads: number;
  maxAssetBytes: number;
  maxJobBytes: number;
  downloadTimeoutMs: number;
  retentionHours: number;
  allowPrivateHosts: boolean;
  trustProxy: boolean;
  logLevel: LogLevel;
  version: string;
  sftpDefaults: {
    host: string;
    port: number;
    username: string;
    remotePath: string;
  };
}

class ConfigError extends Error {}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ConfigError(`${name} must be a number, got "${raw}".`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}, got ${value}.`);
  }
  return value;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new ConfigError(`${name} must be true or false, got "${raw}".`);
}

/**
 * Reads the version from package.json rather than hardcoding it, so `/api/health`
 * and the UI footer cannot drift away from what was actually deployed.
 */
function readVersion(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // Walk up looking for the package.json, since the compiled layout differs from source.
  for (const candidate of ['../../../package.json', '../../../../package.json', './package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(moduleDir, candidate), 'utf8')) as {
        version?: string;
        name?: string;
      };
      if (pkg.name === 'podcast-rss-migrater' && pkg.version) return pkg.version;
    } catch {
      // Not this one.
    }
  }
  return '0.0.0';
}

export function loadConfig(): Config {
  const logLevel = envString('MIGRATER_LOG_LEVEL', 'info') as LogLevel;
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new ConfigError(`MIGRATER_LOG_LEVEL must be debug, info, warn or error, got "${logLevel}".`);
  }

  return {
    dataPath: resolve(process.cwd(), envString('MIGRATER_DATA_PATH', './data')),
    defaultBaseUrl: envString('MIGRATER_DEFAULT_BASE_URL', ''),
    jpegQuality: envNumber('MIGRATER_JPEG_QUALITY', 90, 1, 100),
    maxConcurrentJobs: envNumber('MIGRATER_MAX_CONCURRENT_JOBS', 1, 1, 8),
    maxConcurrentDownloads: envNumber('MIGRATER_MAX_CONCURRENT_DOWNLOADS', 4, 1, 32),
    maxAssetBytes: envNumber('MIGRATER_MAX_ASSET_MB', 1000, 1, 100_000) * 1024 * 1024,
    maxJobBytes: envNumber('MIGRATER_MAX_JOB_GB', 50, 1, 10_000) * 1024 * 1024 * 1024,
    downloadTimeoutMs: envNumber('MIGRATER_DOWNLOAD_TIMEOUT_MS', 60_000, 1000, 3_600_000),
    retentionHours: envNumber('MIGRATER_JOB_RETENTION_HOURS', 24, 0.25, 8760),
    allowPrivateHosts: envBoolean('MIGRATER_ALLOW_PRIVATE_HOSTS', false),
    trustProxy: envBoolean('MIGRATER_TRUST_PROXY', false),
    logLevel,
    version: readVersion(),
    sftpDefaults: {
      host: envString('MIGRATER_SFTP_HOST', ''),
      port: envNumber('MIGRATER_SFTP_PORT', 22, 1, 65535),
      username: envString('MIGRATER_SFTP_USERNAME', ''),
      remotePath: envString('MIGRATER_SFTP_REMOTE_PATH', '/'),
    },
  };
}

let cached: Config | null = null;

/** The active configuration. Parsed once on first use. */
export function config(): Config {
  cached ??= loadConfig();
  return cached;
}

/** Test seam: forces the next config() call to re-read the environment. */
export function resetConfig(): void {
  cached = null;
}
