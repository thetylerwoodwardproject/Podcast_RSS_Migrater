import type { RequestHandler } from './$types';

import { ERROR_MESSAGES, UserFacingError } from '$lib/server/errors';
import { failure, ok } from '$lib/server/http';
import { getJob } from '$lib/server/jobs/queue';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;

/**
 * The asset list, paged.
 *
 * Assets are deliberately kept out of the job payload and off the event stream:
 * a long back catalogue holds thousands of them, and shipping the whole array on
 * every progress tick would dwarf everything else going over the wire. The UI
 * fetches this only when a job is expanded.
 */
export const GET: RequestHandler = ({ params, url }) => {
  try {
    const job = getJob(params.id);
    if (!job) throw new UserFacingError(ERROR_MESSAGES.notFound, 404);

    const all = [...job.assets.values()];
    const kind = url.searchParams.get('kind');
    const status = url.searchParams.get('status');

    const filtered = all.filter(
      (asset) => (!kind || asset.kind === kind) && (!status || asset.status === status),
    );

    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));

    return ok({ assets: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit });
  } catch (error) {
    return failure(error, { route: 'GET /api/jobs/[id]/assets' });
  }
};
