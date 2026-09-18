import type { RequestHandler } from './$types';

import { failure, ok } from '$lib/server/http';
import { startJob } from '$lib/server/jobs/runner';

export const POST: RequestHandler = ({ params }) => {
  try {
    return ok({ job: startJob(params.id) });
  } catch (error) {
    return failure(error, { route: 'POST /api/jobs/[id]/start' });
  }
};
