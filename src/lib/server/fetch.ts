import { createWriteStream } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { config } from './config.js';
import { ERROR_MESSAGES, UserFacingError } from './errors.js';
import { logger } from './logger.js';

const MAX_REDIRECTS = 5;
const USER_AGENT = 'PodcastRSSMigrater/1.0 (+https://github.com/thetylerwoodwardproject/Podcast_RSS_Migrater)';

export interface FetchedText {
  url: string;
  body: string;
  contentType: string | null;
}

export interface DownloadResult {
  /** The URL that finally served the bytes, after any redirects. */
  resolvedUrl: string;
  bytes: number;
  contentType: string | null;
}

/**
 * Parses and vets a URL supplied by a user or found in a feed.
 *
 * The Python version fetched at most one cover URL from someone's own terminal.
 * This runs on a server, so every URL a stranger's feed names is a request the
 * server can be made to send: scheme, credentials and address range all have to
 * be checked before anything is opened.
 */
export function parseRemoteUrl(raw: string, message: string = ERROR_MESSAGES.badFeedUrl): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UserFacingError(message);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UserFacingError(message);
  }
  if (url.username !== '' || url.password !== '') {
    throw new UserFacingError(message);
  }
  return url;
}

/**
 * Validates a base URL the migrated feed will point at.
 *
 * Same rules as the Python `--base-url` check: http(s), a host, and no query,
 * fragment or credentials. A trailing slash is added so callers can concatenate.
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') throw new UserFacingError(ERROR_MESSAGES.badBaseUrl);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UserFacingError(ERROR_MESSAGES.badBaseUrl);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UserFacingError(ERROR_MESSAGES.badBaseUrl);
  if (url.hostname === '') throw new UserFacingError(ERROR_MESSAGES.badBaseUrl);
  if (url.search !== '' || url.hash !== '') throw new UserFacingError(ERROR_MESSAGES.badBaseUrl);
  if (url.username !== '' || url.password !== '') throw new UserFacingError(ERROR_MESSAGES.badBaseUrl);

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/`;
}

/** True for loopback, link-local, private and other non-routable addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const parts = address.split('.').map(Number);
    const [a = 0, b = 0] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80')) return true; // link-local
    if (/^f[cd]/.test(lower)) return true; // unique local
    // IPv4-mapped, e.g. ::ffff:127.0.0.1
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return false;
  }

  return false;
}

async function assertPublicHost(url: URL): Promise<void> {
  if (config().allowPrivateHosts) return;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) throw new UserFacingError(ERROR_MESSAGES.privateHost);
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UserFacingError(`That host could not be resolved: ${host}`);
  }

  // Refuse if any answer is private. A name that resolves to both a public and a
  // private address is exactly the DNS-rebinding shape worth refusing outright.
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UserFacingError(ERROR_MESSAGES.privateHost);
  }
}

/**
 * Performs a request, following redirects one hop at a time.
 *
 * Redirects are followed manually rather than with `redirect: 'follow'` so each
 * new location is vetted too; otherwise a public URL could redirect straight to
 * 169.254.169.254 and bypass every check above.
 */
async function guardedRequest(
  raw: string,
  init: RequestInit,
  message: string,
): Promise<{ response: Response; resolvedUrl: string }> {
  let current = parseRemoteUrl(raw, message);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(current);

    const response = await fetch(current, {
      ...init,
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new UserFacingError(`Redirect without a location: ${current.href}`);
      current = parseRemoteUrl(new URL(location, current).href, message);
      continue;
    }

    return { response, resolvedUrl: current.href };
  }

  throw new UserFacingError(`Too many redirects: ${raw}`);
}

/** Fetches a small text document (a feed, or a chapters JSON) with a byte cap. */
export async function fetchText(
  raw: string,
  maxBytes: number,
  message: string = ERROR_MESSAGES.badFeedUrl,
): Promise<FetchedText> {
  const timeout = AbortSignal.timeout(config().downloadTimeoutMs);
  const { response, resolvedUrl } = await guardedRequest(raw, { signal: timeout }, message);

  if (!response.ok) {
    await response.body?.cancel();
    throw new UserFacingError(`That URL returned HTTP ${response.status}: ${raw}`);
  }

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new UserFacingError(ERROR_MESSAGES.assetTooLarge);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new UserFacingError(ERROR_MESSAGES.assetTooLarge);

  return {
    url: resolvedUrl,
    body: buffer.toString('utf8'),
    contentType: response.headers.get('content-type'),
  };
}

/**
 * Streams a URL to a local file.
 *
 * The response is written straight through rather than buffered: a single episode
 * can be hundreds of megabytes, and a job can be tens of gigabytes. The size cap
 * is enforced as bytes arrive, not only from Content-Length, because a server is
 * free to lie about or omit that header.
 */
export async function downloadToFile(
  raw: string,
  destination: string,
  options: { maxBytes: number; signal?: AbortSignal },
): Promise<DownloadResult> {
  const timeout = AbortSignal.timeout(config().downloadTimeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  const { response, resolvedUrl } = await guardedRequest(raw, { signal }, ERROR_MESSAGES.downloadFailed);

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new UserFacingError(`That asset returned HTTP ${response.status}: ${raw}`);
  }

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body.cancel();
    throw new UserFacingError(ERROR_MESSAGES.assetTooLarge);
  }

  let written = 0;
  const counted = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      written += chunk.byteLength;
      if (written > options.maxBytes) {
        controller.error(new UserFacingError(ERROR_MESSAGES.assetTooLarge));
        return;
      }
      controller.enqueue(chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body.pipeThrough(counted) as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(destination),
  );

  return { resolvedUrl, bytes: written, contentType: response.headers.get('content-type') };
}

/** Retries a download with exponential backoff. Only transport failures are retried. */
export async function downloadWithRetry(
  raw: string,
  destination: string,
  options: { maxBytes: number; signal?: AbortSignal; attempts?: number },
): Promise<DownloadResult> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await downloadToFile(raw, destination, options);
    } catch (error) {
      lastError = error;

      // A refused host, an oversized asset or a cancelled job will not improve on a retry.
      const fatal =
        options.signal?.aborted === true ||
        (error instanceof UserFacingError &&
          (error.message === ERROR_MESSAGES.privateHost || error.message === ERROR_MESSAGES.assetTooLarge));
      if (fatal || attempt === attempts) break;

      const delay = 2 ** (attempt - 1) * 1000;
      logger.warn('download failed, retrying', {
        url: raw,
        attempt,
        delayMs: delay,
        message: error instanceof Error ? error.message : String(error),
      });
      await new Promise((done) => setTimeout(done, delay));
    }
  }

  throw lastError;
}
