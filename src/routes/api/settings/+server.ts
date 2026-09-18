import type { RequestHandler } from './$types';

import type { SftpDefaults } from '$lib/types';
import { config } from '$lib/server/config';
import { ok } from '$lib/server/http';

/**
 * Non-secret SFTP defaults used to prefill the publish form.
 *
 * Credentials are never stored server-side: they arrive with the publish request,
 * are used for that connection, and are discarded. So there is nothing to mask
 * here and no PUT to save.
 */
export const GET: RequestHandler = () => {
  const defaults: SftpDefaults = config().sftpDefaults;
  return ok({ sftp: defaults, defaultBaseUrl: config().defaultBaseUrl, quality: config().jpegQuality });
};
