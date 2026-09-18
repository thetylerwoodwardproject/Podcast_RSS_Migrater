import type { RequestHandler } from './$types';

import { ERROR_MESSAGES, UserFacingError } from '$lib/server/errors';
import { failure, ok } from '$lib/server/http';
import { deleteJob, getJob, toPublicJob } from '$lib/server/jobs/queue';
import { removeWorkspace } from '$lib/server/jobs/workspace';

export const GET: RequestHandler = ({ params }) => {
  const job = getJob(params.id);
  if (!job) return failure(new UserFacingError(ERROR_MESSAGES.notFound, 404), { route: 'GET /api/jobs/[id]' });
  return ok({ job: toPublicJob(job), warnings: job.warnings, log: job.log });
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    const job = getJob(params.id);
    if (!job) throw new UserFacingError(ERROR_MESSAGES.notFound, 404);

    // Stop any work in flight before the files go, so a download in progress
    // cannot recreate the directory that is being removed.
    job.abort.abort();
    deleteJob(job.id);
    await removeWorkspace(job.id);

    return ok({ deleted: true });
  } catch (error) {
    return failure(error, { route: 'DELETE /api/jobs/[id]' });
  }
};
