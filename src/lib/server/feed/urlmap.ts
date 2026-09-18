import { UserFacingError } from '../errors.js';

/**
 * Percent-encodes a relative path for use in a hosted URL.
 *
 * This deliberately reproduces Python's `urllib.parse.quote(path, safe="/")`
 * rather than using `encodeURIComponent`. The two disagree: Python escapes
 * `! * ' ( )` and JavaScript does not. That difference is not cosmetic -- the
 * encoded path is both the URL written into the feed and the object key uploaded
 * to the host, so an episode called `Live (Part 1)!.mp3` would end up with a feed
 * pointing at a key that was never created.
 *
 * Python's unreserved set is `A-Za-z0-9_.-~`, plus `/` via `safe`.
 */
export function quotePath(relative: string): string {
  return relative
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

export function hostedUrl(baseUrl: string, relative: string): string {
  return `${baseUrl}${quotePath(relative)}`;
}

/**
 * Accumulates old-URL to new-URL mappings, refusing ambiguity.
 *
 * One source URL resolving to two different files means the feed cannot be
 * rewritten unambiguously, which the Python treats as fatal. So does this.
 */
export class UrlMap {
  private readonly mapping = new Map<string, string>();

  add(oldUrl: string | null | undefined, newUrl: string): void {
    if (!oldUrl) return;
    const existing = this.mapping.get(oldUrl);
    if (existing !== undefined && existing !== newUrl) {
      throw new UserFacingError(`One source URL maps to two different files: ${oldUrl}`);
    }
    this.mapping.set(oldUrl, newUrl);
  }

  get(oldUrl: string): string | undefined {
    return this.mapping.get(oldUrl);
  }

  has(oldUrl: string): boolean {
    return this.mapping.has(oldUrl);
  }

  get size(): number {
    return this.mapping.size;
  }

  entries(): [string, string][] {
    return [...this.mapping.entries()];
  }

  toMap(): Map<string, string> {
    return new Map(this.mapping);
  }
}
