import { config } from '$lib/server/config';
import { startCleanupScheduler, stopCleanupScheduler, sweepExpiredJobs } from '$lib/server/jobs/cleanup';
import { closeAllEventStreams } from '$lib/server/jobs/events';
import { listJobs } from '$lib/server/jobs/queue';
import { ensureDataDirs, isWritable } from '$lib/server/jobs/workspace';
import { stopAcceptingWork } from '$lib/server/lifecycle';
import { logger, setLogLevel } from '$lib/server/logger';

/**
 * Boot and shutdown.
 *
 * This module body runs once when the server starts, which is the adapter-node
 * equivalent of a main() function. Everything here is process-wide setup, so it
 * deliberately runs at import time rather than per request.
 */
const cfg = config();
setLogLevel(cfg.logLevel);

logger.info('Podcast RSS Migrater starting', { version: cfg.version, node: process.version });

await ensureDataDirs();
if (!(await isWritable(cfg.dataPath))) {
  logger.error('data directory is not writable', { path: cfg.dataPath });
  logger.error('The app cannot run without writable storage. Check MIGRATER_DATA_PATH and its permissions.');
  process.exit(1);
}
logger.info('storage ready', { path: cfg.dataPath, retentionHours: cfg.retentionHours });

// Reclaims whatever a previous process left behind: job state is in memory only,
// so after a restart the archives on disk have nothing pointing at them.
await sweepExpiredJobs();
startCleanupScheduler();

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('shutdown requested', { signal });
  stopAcceptingWork();
  stopCleanupScheduler();

  // Downloads in flight are abandoned rather than finished: systemd and Docker
  // both expect the process to go down promptly, not to finish a 20 GB archive.
  for (const job of listJobs()) job.abort.abort();

  // Load-bearing. An SSE stream is an in-flight request that never ends on its
  // own, and adapter-node waits for in-flight requests before closing, so
  // without this every shutdown would stall until the timeout elapsed.
  closeAllEventStreams();
}

process.on('sveltekit:shutdown', () => shutdown('sveltekit'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
