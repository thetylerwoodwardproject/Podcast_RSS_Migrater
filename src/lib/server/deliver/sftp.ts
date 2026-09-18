import { posix } from 'node:path';

import SftpClient from 'ssh2-sftp-client';

import { logger } from '../logger.js';
import { listWorkspaceFiles } from '../jobs/workspace.js';

export interface SftpCredentials {
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  remotePath: string;
}

export interface PublishProgress {
  uploaded: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
  current: string;
}

export interface PublishResult {
  ok: boolean;
  uploaded: number;
  skipped: number;
  total: number;
  error: string | null;
}

/**
 * Reduces an ssh2 error to something safe to show.
 *
 * Its messages can embed the username, the host and occasionally parts of a key,
 * so the text is matched against a small vocabulary rather than passed through.
 */
export function maskError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes('authentication') || lower.includes('all configured authentication methods failed')) {
    return 'Authentication failed. Check the username and password or key.';
  }
  if (lower.includes('enotfound') || lower.includes('getaddrinfo')) return 'That host could not be resolved.';
  if (lower.includes('econnrefused')) return 'The host refused the connection on that port.';
  if (lower.includes('etimedout') || lower.includes('timeout')) return 'The connection to the host timed out.';
  if (lower.includes('permission denied') || lower.includes('eacces')) {
    return 'Permission denied writing to the remote path.';
  }
  if (lower.includes('no such file')) return 'The remote path does not exist and could not be created.';
  if (lower.includes('econnreset') || lower.includes('closed')) return 'The host closed the connection.';
  return 'The SFTP transfer failed.';
}

function validate(credentials: SftpCredentials): string | null {
  if (!credentials.host.trim()) return 'A host is required.';
  if (!credentials.username.trim()) return 'A username is required.';
  if (credentials.authType === 'key' && !credentials.privateKey) return 'A private key is required for key auth.';
  if (credentials.authType === 'password' && !credentials.password) return 'A password is required for password auth.';
  return null;
}

function remoteJoin(base: string, relative: string): string {
  const root = (base || '/').replace(/\/+$/, '');
  return `${root === '' ? '' : root}/${relative}`;
}

/**
 * Uploads a whole job workspace over SFTP, preserving relative paths.
 *
 * Three things matter here that a string-upload helper does not have to handle:
 *
 * - `fastPut` streams from disk. `put(Buffer.from(...))` would load an entire
 *   episode into memory, and an archive can be tens of gigabytes.
 * - Directories are created once each, not once per file. A 500-episode archive
 *   is only a handful of directories but thousands of files.
 * - A file whose remote size already matches is skipped, so an upload that died
 *   at 80% resumes rather than starting over.
 */
export async function publishWorkspace(
  jobId: string,
  credentials: SftpCredentials,
  onProgress: (progress: PublishProgress) => void,
  signal?: AbortSignal,
): Promise<PublishResult> {
  const invalid = validate(credentials);
  if (invalid) return { ok: false, uploaded: 0, skipped: 0, total: 0, error: invalid };

  const files = await listWorkspaceFiles(jobId);
  const bytesTotal = files.reduce((total, file) => total + file.bytes, 0);
  if (files.length === 0) {
    return { ok: false, uploaded: 0, skipped: 0, total: 0, error: 'This job has nothing to publish.' };
  }

  const client = new SftpClient();
  const createdDirectories = new Set<string>();
  let uploaded = 0;
  let skipped = 0;
  let bytesDone = 0;

  try {
    await client.connect({
      host: credentials.host,
      port: credentials.port || 22,
      username: credentials.username,
      password: credentials.authType === 'password' ? credentials.password : undefined,
      privateKey: credentials.authType === 'key' ? credentials.privateKey : undefined,
      passphrase: credentials.authType === 'key' ? credentials.passphrase : undefined,
      readyTimeout: 20_000,
    });

    for (const file of files) {
      if (signal?.aborted) {
        return { ok: false, uploaded, skipped, total: files.length, error: 'Publishing was cancelled.' };
      }

      const remote = remoteJoin(credentials.remotePath, file.relativePath);
      const directory = posix.dirname(remote);

      if (directory !== '.' && directory !== '' && !createdDirectories.has(directory)) {
        await client.mkdir(directory, true);
        createdDirectories.add(directory);
      }

      // Skip anything already fully uploaded, so a retry resumes where it stopped.
      let existingSize: number | null = null;
      try {
        const stats = await client.stat(remote);
        existingSize = stats.size;
      } catch {
        existingSize = null;
      }

      if (existingSize === file.bytes) {
        skipped += 1;
        bytesDone += file.bytes;
      } else {
        await client.fastPut(file.absolutePath, remote);
        uploaded += 1;
        bytesDone += file.bytes;
      }

      onProgress({
        uploaded: uploaded + skipped,
        total: files.length,
        bytesDone,
        bytesTotal,
        current: file.relativePath,
      });
    }

    return { ok: true, uploaded, skipped, total: files.length, error: null };
  } catch (error) {
    // Only the host and username are logged. The credentials object itself must
    // never reach the logger.
    logger.error('sftp publish failed', {
      jobId,
      host: credentials.host,
      username: credentials.username,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, uploaded, skipped, total: files.length, error: maskError(error) };
  } finally {
    await client.end().catch(() => {});
  }
}
