import type { RequestHandler } from './$types';

import { config } from '$lib/server/config';
import { publishWorkspace, type SftpCredentials } from '$lib/server/deliver/sftp';
import { ERROR_MESSAGES, UserFacingError } from '$lib/server/errors';
import { failure, ok, readJson } from '$lib/server/http';
import { appendLog, getJob, updateJob } from '$lib/server/jobs/queue';
import { isAcceptingWork } from '$lib/server/lifecycle';

function readCredentials(body: Record<string, unknown>): SftpCredentials {
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const defaults = config().sftpDefaults;

  const port = typeof body.port === 'number' ? body.port : Number(text(body.port)) || defaults.port;
  const authType = text(body.authType) === 'key' ? 'key' : 'password';

  return {
    host: text(body.host) || defaults.host,
    port,
    username: text(body.username) || defaults.username,
    authType,
    // Secrets are taken from the request only. Nothing is read from or written
    // to disk, so a stolen data directory yields no credentials.
    password: authType === 'password' ? text(body.password) : undefined,
    privateKey: authType === 'key' ? text(body.privateKey) : undefined,
    passphrase: authType === 'key' ? text(body.passphrase) || undefined : undefined,
    remotePath: text(body.remotePath) || defaults.remotePath || '/',
  };
}

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    if (!isAcceptingWork()) throw new UserFacingError(ERROR_MESSAGES.serverShuttingDown, 503);

    const job = getJob(params.id);
    if (!job) throw new UserFacingError(ERROR_MESSAGES.notFound, 404);
    if (job.phase !== 'ready' && job.phase !== 'complete') {
      throw new UserFacingError(ERROR_MESSAGES.wrongPhase, 409);
    }
    if (job.delivery.sftpStatus === 'running') {
      throw new UserFacingError('This job is already being published.', 409);
    }

    const credentials = readCredentials(await readJson(request));

    updateJob(job.id, {
      phase: 'publishing',
      delivery: { ...job.delivery, sftpStatus: 'running', sftpError: null, sftpUploaded: 0 },
    });
    appendLog(job.id, 'info', `Publishing to ${credentials.host} over SFTP.`);

    const result = await publishWorkspace(
      job.id,
      credentials,
      (progress) => {
        updateJob(job.id, {
          delivery: { ...job.delivery, sftpUploaded: progress.uploaded, sftpTotal: progress.total },
          progress: {
            done: progress.uploaded,
            total: progress.total,
            bytesDone: progress.bytesDone,
            bytesTotal: progress.bytesTotal,
            current: progress.current,
          },
        });
      },
      job.abort.signal,
    );

    if (!result.ok) {
      updateJob(job.id, {
        phase: 'ready',
        delivery: { ...job.delivery, sftpStatus: 'failed', sftpError: result.error },
      });
      appendLog(job.id, 'error', result.error ?? ERROR_MESSAGES.publishFailed);
      return ok({ ok: false, error: result.error ?? ERROR_MESSAGES.publishFailed }, 502);
    }

    updateJob(job.id, {
      phase: 'complete',
      delivery: {
        ...job.delivery,
        sftpStatus: 'complete',
        sftpUploaded: result.uploaded + result.skipped,
        sftpTotal: result.total,
        sftpError: null,
      },
    });
    appendLog(
      job.id,
      'info',
      `Published ${result.uploaded} file(s); ${result.skipped} were already up to date.`,
    );

    return ok({ ok: true, uploaded: result.uploaded, skipped: result.skipped, total: result.total });
  } catch (error) {
    return failure(error, { route: 'POST /api/jobs/[id]/publish' });
  }
};
