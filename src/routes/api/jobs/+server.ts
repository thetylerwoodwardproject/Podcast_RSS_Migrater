import type { RequestHandler } from './$types';

import { failure, ok, readJson } from '$lib/server/http';
import { snapshot } from '$lib/server/jobs/queue';
import { createJob } from '$lib/server/jobs/runner';

export const GET: RequestHandler = () => ok({ jobs: snapshot() });

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await readJson(request);
    const job = await createJob({
      feedUrl: typeof body.feedUrl === 'string' ? body.feedUrl : '',
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : '',
      quality: typeof body.quality === 'number' ? body.quality : undefined,
      rehostFeed: typeof body.rehostFeed === 'boolean' ? body.rehostFeed : undefined,
    });
    return ok({ job }, 201);
  } catch (error) {
    return failure(error, { route: 'POST /api/jobs' });
  }
};
