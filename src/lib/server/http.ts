import { json } from '@sveltejs/kit';

import { config } from './config.js';
import { ERROR_MESSAGES, UserFacingError } from './errors.js';
import { logger } from './logger.js';

export function ok(data: unknown, status = 200): Response {
  return json(data, { status });
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

/**
 * Turns anything thrown in a route into a safe JSON response.
 *
 * Only curated messages reach the browser; stack traces, feed contents and
 * filesystem paths stay in the server log.
 */
export function failure(error: unknown, context: Record<string, string>): Response {
  if (error instanceof UserFacingError) {
    logger.warn('request rejected', { ...context, status: error.status, reason: error.message, detail: error.detail });
    return fail(error.message, error.status);
  }

  logger.error('unhandled error', {
    ...context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
  });
  return fail(ERROR_MESSAGES.unexpected, 500);
}

/** Reads and parses a JSON request body, rejecting anything malformed. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new UserFacingError('Invalid JSON body.');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new UserFacingError('Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

/** Resolves the public origin (no trailing slash) for absolute links back to this app. */
export function resolveOrigin(request: Request): string {
  const url = new URL(request.url);
  if (!config().trustProxy) return url.origin;

  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (proto && host) return `${proto}://${host}`;
  return url.origin;
}
