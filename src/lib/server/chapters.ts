import { UserFacingError } from './errors.js';
import type { Replacer } from './feed/rewrite.js';

export interface ChapterRewrite {
  /** The rewritten document, or null when nothing in it changed. */
  text: string | null;
  /** Every `chapters[].img` URL present after rewriting. */
  imageUrls: string[];
}

/**
 * Rewrites the URLs in one Podlove Simple Chapters document.
 *
 * Like the feed, this is a raw-text substitution: the JSON is re-parsed only to
 * prove the result is still valid and to read back the image URLs for
 * validation. Key order, indentation and number formatting are preserved, which
 * matters because a chapters file may be served with a strong ETag.
 *
 * `chapters[].url` is a website link rather than an asset, so it is never
 * downloaded and never validated. It is still subject to the substitution, since
 * that is document-wide: if it happens to name an asset that moved, it follows
 * it, which is what you would want.
 */
export function rewriteChapters(original: string, replace: Replacer, label: string): ChapterRewrite {
  const rewritten = replace(original);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rewritten);
  } catch {
    throw new UserFacingError(`Rewriting produced invalid JSON in ${label}.`);
  }

  const imageUrls: string[] = [];
  const chapters = (parsed as { chapters?: unknown }).chapters;
  if (Array.isArray(chapters)) {
    for (const chapter of chapters) {
      if (typeof chapter !== 'object' || chapter === null) continue;
      const img = (chapter as { img?: unknown }).img;
      if (typeof img === 'string' && img.trim() !== '') imageUrls.push(img.trim());
    }
  }

  return { text: rewritten === original ? null : rewritten, imageUrls };
}

export function parseChaptersJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new UserFacingError(`${label} is not valid JSON.`);
  }
}
