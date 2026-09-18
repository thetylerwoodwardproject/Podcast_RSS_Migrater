import type { RequestHandler } from './$types';

import { ERROR_MESSAGES, UserFacingError } from '$lib/server/errors';
import { failure } from '$lib/server/http';
import { getJob } from '$lib/server/jobs/queue';

/** The rewritten feed, so the result can be read before anything is published. */
export const GET: RequestHandler = ({ params }) => {
  try {
    const job = getJob(params.id);
    if (!job) throw new UserFacingError(ERROR_MESSAGES.notFound, 404);
    if (job.feedAfter === null) throw new UserFacingError(ERROR_MESSAGES.wrongPhase, 409);

    return new Response(job.feedAfter, {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return failure(error, { route: 'GET /api/jobs/[id]/feed' });
  }
};
