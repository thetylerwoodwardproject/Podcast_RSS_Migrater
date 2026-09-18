import { Readable } from 'node:stream';

import { type ArchiverError, ZipArchive } from 'archiver';

import { logger } from '../logger.js';
import { slugify } from '../filenames.js';
import { workspacePath } from '../jobs/workspace.js';

/**
 * Streams a job's archive to the client as a ZIP.
 *
 * Unlike the sibling projects, nothing is staged to disk first. An archive can be
 * tens of gigabytes and building a second copy just to serve it would double the
 * disk requirement -- on this app disk is the scarce resource, not CPU.
 *
 * The trade-off is that the response has no Content-Length, so the browser cannot
 * show a percentage and the download is not resumable. That is why SFTP is the
 * recommended route for a large back catalogue, and why the UI says so.
 *
 * Entries are stored rather than deflated: audio and JPEG are already compressed,
 * so deflate would burn CPU for a fraction of a percent.
 */
export function streamWorkspaceZip(jobId: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const root = workspacePath(jobId);
  const archive = new ZipArchive({ zlib: { level: 0 } });

  archive.on('warning', (warning: ArchiverError) => {
    logger.warn('archive warning', { jobId, message: warning.message });
  });
  archive.on('error', (error: ArchiverError) => {
    logger.error('archive failed', { jobId, message: error.message });
  });

  // Dotfiles are excluded, which covers the staging and backup directories: they
  // hold pre-rewrite copies and would put stale URLs in the delivered archive.
  archive.glob('**/*', { cwd: root, dot: false });
  void archive.finalize();

  // Without this the archiver keeps reading the whole tree after the browser has
  // given up, holding file handles and CPU for a download nobody is receiving.
  signal?.addEventListener('abort', () => {
    archive.abort();
  });

  return Readable.toWeb(archive) as ReadableStream<Uint8Array>;
}

export function archiveFilename(showTitle: string | null): string {
  return `${slugify(showTitle ?? 'podcast', 'podcast')}-archive.zip`;
}
