import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { deleteJob, listJobs } from './queue.js';
import { jobsRoot } from './workspace.js';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

interface Scheduler {
  timer: NodeJS.Timeout | null;
}

// Anchored on globalThis for the same reason the queue is: a dev-server reload
// would otherwise leave the old interval running and start a second one.
const SCHEDULER_KEY = Symbol.for('migrater.cleanup');
const scheduler: Scheduler = ((globalThis as Record<symbol, unknown>)[SCHEDULER_KEY] ??= {
  timer: null,
}) as Scheduler;

/**
 * Deletes job workspaces past the retention window and drops the queue entries
 * that referred to them.
 *
 * The filesystem is the authority here. Job state is in memory only, so a restart
 * leaves whole multi-gigabyte archives on disk with nothing pointing at them;
 * this sweep is the only thing that reclaims them.
 */
export async function sweepExpiredJobs(): Promise<{ removedWorkspaces: number; removedJobs: number }> {
  const cutoff = Date.now() - config().retentionHours * 60 * 60 * 1000;
  const root = jobsRoot();

  let removedWorkspaces = 0;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return { removedWorkspaces: 0, removedJobs: 0 };
  }

  for (const entry of entries) {
    const path = join(root, entry);
    try {
      const stats = await stat(path);
      if (!stats.isDirectory() || stats.mtimeMs >= cutoff) continue;

      await rm(path, { recursive: true, force: true });
      removedWorkspaces += 1;
    } catch {
      // Removed by something else, or not readable. Either way there is nothing to do.
    }
  }

  let removedJobs = 0;
  for (const job of listJobs()) {
    if (job.createdAt >= cutoff) continue;
    job.abort.abort();
    deleteJob(job.id);
    removedJobs += 1;
  }

  if (removedWorkspaces > 0 || removedJobs > 0) {
    logger.info('cleanup sweep removed expired jobs', { removedWorkspaces, removedJobs });
  }

  return { removedWorkspaces, removedJobs };
}

export function startCleanupScheduler(): void {
  if (scheduler.timer) return;

  scheduler.timer = setInterval(() => {
    void sweepExpiredJobs().catch((error: unknown) => {
      logger.error('cleanup sweep failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, SWEEP_INTERVAL_MS);

  scheduler.timer.unref();
}

export function stopCleanupScheduler(): void {
  if (!scheduler.timer) return;
  clearInterval(scheduler.timer);
  scheduler.timer = null;
}
