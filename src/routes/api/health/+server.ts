import type { RequestHandler } from './$types';

import type { HealthResponse } from '$lib/types';
import { config } from '$lib/server/config';
import { ok } from '$lib/server/http';
import { supportedImageFormats } from '$lib/server/images';
import { freeBytes } from '$lib/server/jobs/workspace';
import { isAcceptingWork } from '$lib/server/lifecycle';

export const GET: RequestHandler = async () => {
  const formats = supportedImageFormats();
  const body: HealthResponse = {
    // Without a JPEG encoder nothing can be converted, so that is the one
    // capability whose absence makes the app degraded rather than merely limited.
    status: formats.includes('jpeg') ? 'ok' : 'degraded',
    version: config().version,
    imageFormats: formats,
    diskFreeBytes: await freeBytes(),
    acceptingWork: isAcceptingWork(),
  };
  return ok(body);
};
