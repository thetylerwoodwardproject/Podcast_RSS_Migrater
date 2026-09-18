/**
 * URL replacement is a raw-text substitution over the whole document, not an XML
 * tree edit. This is deliberate and load-bearing.
 *
 * Podcast show notes routinely embed asset URLs inside CDATA sections and inside
 * HTML that has been escaped into a `<description>` -- places no XML-aware
 * rewriter would look, which is why the replacement table also carries an
 * HTML-escaped variant of every URL. Rewriting the parsed tree would also
 * reserialize every element in the feed, changing whitespace, attribute order,
 * entity style and comments that the migration has no business touching.
 *
 * Everything outside a mapped URL must come out byte-identical.
 */

import { UserFacingError } from '../errors.js';

/**
 * Matches Python's `html.escape(s, quote=True)`.
 *
 * Note `&#x27;` for the apostrophe: Python emits the hex form, and a feed whose
 * show notes contain an escaped URL with an apostrophe would not match if this
 * produced `&#39;` instead.
 */
export function htmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type Replacer = (text: string) => string;

/**
 * Builds the substitution function for a URL map.
 *
 * Keys are sorted longest-first because JavaScript's regular expression
 * alternation is leftmost-first-alternative, exactly like Python's `re`. Without
 * that ordering a short URL that is a prefix of a longer one would match first
 * and leave the rest of the longer URL behind, silently corrupting it.
 */
export function buildReplacer(urlMap: Map<string, string>): Replacer {
  const table = new Map(urlMap);
  for (const [oldUrl, newUrl] of urlMap) {
    table.set(htmlEscape(oldUrl), htmlEscape(newUrl));
  }
  if (table.size === 0) return (text) => text;

  const keys = [...table.keys()].sort((a, b) => b.length - a.length);

  let pattern: RegExp;
  try {
    pattern = new RegExp(keys.map(escapeRegExp).join('|'), 'g');
  } catch {
    // A very large back catalogue can exceed the engine's pattern limits. Fall
    // back to chunked passes, which is slower but produces the same result:
    // each chunk keeps its own longest-first ordering and no key is a substring
    // of a key in an earlier chunk, because the whole list was sorted first.
    const chunks: RegExp[] = [];
    const size = 500;
    for (let start = 0; start < keys.length; start += size) {
      chunks.push(new RegExp(keys.slice(start, start + size).map(escapeRegExp).join('|'), 'g'));
    }
    return (text) => chunks.reduce((acc, chunk) => acc.replace(chunk, (match) => table.get(match) ?? match), text);
  }

  return (text) => text.replace(pattern, (match) => table.get(match) ?? match);
}

/** Half-open `[start, end)` spans of comments and CDATA sections. */
export function protectedRegions(xml: string): [number, number][] {
  const regions: [number, number][] = [];

  const scan = (open: string, close: string): void => {
    let from = 0;
    for (;;) {
      const start = xml.indexOf(open, from);
      if (start === -1) break;
      const end = xml.indexOf(close, start + open.length);
      const stop = end === -1 ? xml.length : end + close.length;
      regions.push([start, stop]);
      from = stop;
    }
  };

  scan('<!--', '-->');
  scan('<![CDATA[', ']]>');
  return regions.sort((a, b) => a[0] - b[0]);
}

function isProtected(regions: [number, number][], index: number): boolean {
  return regions.some(([start, end]) => index >= start && index < end);
}

const ATTRIBUTE_PATTERN = /([A-Za-z_:][-.\w:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Reads an attribute out of a raw start tag without parsing it as a document. */
export function readTagAttribute(tag: string, name: string): string | null {
  ATTRIBUTE_PATTERN.lastIndex = 0;
  for (;;) {
    const match = ATTRIBUTE_PATTERN.exec(tag);
    if (!match) return null;
    if (match[1] === name) return unescapeXml(match[2] ?? match[3] ?? '');
  }
}

export interface EnclosureFix {
  url: string;
  /** Byte length written into the tag. */
  length: number;
  /** True when the tag had no length attribute and one was added. */
  inserted: boolean;
}

export interface EnclosureResult {
  xml: string;
  fixes: EnclosureFix[];
  /** URLs whose local size could not be determined; the tag was left untouched. */
  unresolved: string[];
}

/**
 * Rewrites every `<enclosure>` length to the real size of the archived file.
 *
 * Three differences from the Python, all fixes rather than ports:
 *
 * 1. It matched only self-closing tags (`<enclosure ... />`), silently skipping
 *    `<enclosure ...></enclosure>`, which is equally valid and does occur.
 * 2. It called `ET.fromstring()` on the isolated tag to read attributes, which
 *    throws `unbound prefix` on any namespaced attribute, because a fragment
 *    carries no namespace declarations. Attributes are read with a regex here.
 * 3. A missing `length` was fatal. This app downloaded the file and knows the
 *    true size, so it inserts the attribute and records a warning instead.
 *
 * Unlike the URL substitution above, this one skips CDATA and comments: an
 * `<enclosure>` written inside show notes is prose, not a real enclosure.
 */
export function fixEnclosureLengths(xml: string, sizeOf: (url: string) => number | null): EnclosureResult {
  const regions = protectedRegions(xml);
  const fixes: EnclosureFix[] = [];
  const unresolved: string[] = [];

  const output = xml.replace(/<enclosure\b[^>]*?(?:\/>|>)/gi, (tag, offset: number) => {
    if (isProtected(regions, offset)) return tag;

    const url = readTagAttribute(tag, 'url');
    if (url === null || url === '') return tag;

    const size = sizeOf(url);
    if (size === null) {
      unresolved.push(url);
      return tag;
    }

    const existing = /\blength\s*=\s*(["'])(.*?)\1/i.exec(tag);
    if (existing) {
      const quote = existing[1] ?? '"';
      fixes.push({ url, length: size, inserted: false });
      return tag.replace(/\blength\s*=\s*(["']).*?\1/i, `length=${quote}${size}${quote}`);
    }

    // No length attribute: insert one just before the tag's closing delimiter.
    fixes.push({ url, length: size, inserted: true });
    return tag.endsWith('/>')
      ? `${tag.slice(0, -2).replace(/\s*$/, '')} length="${size}"/>`
      : `${tag.slice(0, -1).replace(/\s*$/, '')} length="${size}">`;
  });

  return { xml: output, fixes, unresolved };
}

/** Throws when the rewrite changed any episode GUID. */
export function assertGuidsStable(before: string[], after: string[]): void {
  if (before.length !== after.length || before.some((guid, index) => guid !== after[index])) {
    throw new UserFacingError('Episode GUIDs changed during the rewrite. Nothing was delivered.');
  }
}
