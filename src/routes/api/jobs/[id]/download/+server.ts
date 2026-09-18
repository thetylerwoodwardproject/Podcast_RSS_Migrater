import type { RequestHandler } from './$types';

import { ERROR_MESSAGES, UserFacingError } from '$lib/server/errors';
import { archiveFilename, streamWorkspaceZip } from '$lib/server/deliver/zip';
import { failure } from '$lib/server/http';
import { getJob } from '$lib/server/jobs/queue';

export const GET: RequestHandler = ({ params, request }) => {
  try {
    const job = getJob(params.id);
    if (!job) throw new UserFacingError(ERROR_MESSAGES.notFound, 404);
    if (!job.delivery.zipReady) throw new UserFacingError(ERROR_MESSAGES.wrongPhase, 409);

    const filename = archiveFilename(job.showTitle);
    const stream = streamWorkspaceZip(job.id, request.signal);

    // No Content-Length: the archive is built as it is sent, so its size is not
    // known up front. The browser shows an indeterminate download as a result,
    // which is the trade for never staging a second copy on disk.
    return new Response(stream, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return failure(error, { route: 'GET /api/jobs/[id]/download' });
  }
};
