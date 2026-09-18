import { constants } from 'node:fs';
import { access, mkdir, rm, readdir, stat, statfs } from 'node:fs/promises';
import { join, posix } from 'node:path';

import { config } from '../config.js';
import { UserFacingError } from '../errors.js';
import { internalPath, safeJoin } from '../paths.js';

/** Where every job workspace lives. */
export function jobsRoot(): string {
  return join(config().dataPath, 'jobs');
}

/**
 * The directory holding one job's archive.
 *
 * `internalPath` refuses any id that is not a UUID this process generated, so a
 * job id taken straight from a request URL can never name a directory outside
 * this root.
 */
export function workspacePath(jobId: string): string {
  return internalPath(jobsRoot(), jobId);
}

/** Absolute path of one file inside a job's archive, guarded against traversal. */
export function assetPath(jobId: string, relativePath: string): string {
  return safeJoin(workspacePath(jobId), relativePath);
}

export async function ensureDataDirs(): Promise<void> {
  await mkdir(jobsRoot(), { recursive: true });
}

export async function createWorkspace(jobId: string): Promise<string> {
  const root = workspacePath(jobId);
  await mkdir(root, { recursive: true });
  return root;
}

export async function removeWorkspace(jobId: string): Promise<void> {
  await rm(workspacePath(jobId), { recursive: true, force: true });
}

export async function isWritable(directory: string): Promise<boolean> {
  try {
    await access(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Free bytes on the filesystem holding the data directory, or null if unknown. */
export async function freeBytes(): Promise<number | null> {
  try {
    const stats = await statfs(config().dataPath);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

export interface WorkspaceFile {
  /** POSIX path relative to the workspace root. */
  relativePath: string;
  absolutePath: string;
  bytes: number;
}

/**
 * Lists every deliverable file in a workspace.
 *
 * Staging and backup directories are excluded: they hold pre-rewrite copies that
 * exist only so a failed migration can be undone, and shipping them would put
 * stale URLs into the delivered archive.
 */
export async function listWorkspaceFiles(jobId: string): Promise<WorkspaceFile[]> {
  const root = workspacePath(jobId);
  const found: WorkspaceFile[] = [];

  const walk = async (directory: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relativePath = prefix === '' ? entry.name : posix.join(prefix, entry.name);
      const absolutePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const stats = await stat(absolutePath);
        found.push({ relativePath, absolutePath, bytes: stats.size });
      }
    }
  };

  await walk(root, '');
  return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function workspaceBytes(jobId: string): Promise<number> {
  const files = await listWorkspaceFiles(jobId);
  return files.reduce((total, file) => total + file.bytes, 0);
}

/** Refuses to start more work when the disk is nearly full. */
export async function assertDiskHeadroom(needed: number): Promise<void> {
  const free = await freeBytes();
  if (free === null) return;
  if (free < needed) {
    throw new UserFacingError(
      'This server is low on disk space. Delete a finished job and try again.',
      507,
    );
  }
}
