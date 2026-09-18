import type { RequestHandler } from './$types';

import { openEventStream } from '$lib/server/jobs/events';

export const GET: RequestHandler = ({ request }) => openEventStream(request);
