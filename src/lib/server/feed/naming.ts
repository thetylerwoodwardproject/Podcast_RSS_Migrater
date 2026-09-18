import {
  CONTENT_TYPE_EXTENSIONS,
  KIND_DEFAULT_EXTENSION,
  KIND_DIRECTORIES,
} from '../../constants.js';
import type { AssetKind } from '../../types.js';
import { deduplicate, extensionOf, sanitizeFilename, slugify, stemOf } from '../filenames.js';
import type { UrlReference } from './discover.js';

/** Extensions accepted from a URL for each kind. Anything else falls through to the default. */
const PLAUSIBLE_EXTENSIONS: Record<AssetKind, readonly string[]> = {
  audio: ['.mp3', '.m4a', '.mp4', '.aac', '.ogg', '.oga', '.opus', '.flac', '.wav', '.mov', '.m4b'],
  image: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.tif', '.tiff', '.bmp', '.heic'],
  'chapter-image': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.tif', '.tiff', '.bmp', '.heic'],
  chapters: ['.json'],
  transcript: ['.vtt', '.srt', '.json', '.txt', '.html'],
  feed: ['.xml', '.rss'],
};

/**
 * A stem that carries no meaning: a long run of hex or base64 with no vowels is
 * a CDN object key, not a filename worth preserving.
 */
function isOpaqueStem(stem: string): boolean {
  if (stem.length < 12) return false;
  if (/^[0-9a-f]{12,}$/i.test(stem)) return true;
  return /^[A-Za-z0-9_-]{16,}$/.test(stem) && !/[aeiou]/i.test(stem);
}

/**
 * Strips analytics prefixes from an enclosure URL.
 *
 * Podcast hosts routinely wrap media in chained redirectors, so the URL reads
 * `https://chrt.fm/track/ABC/pdst.fm/e/cdn.example.com/ep041.mp3` and the real
 * filename is buried mid-path. Take everything after the last embedded scheme or
 * bare hostname, so the archived name is the one a listener would recognise.
 */
export function unwrapTrackingUrl(raw: string): string {
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    return raw;
  }

  const segments = path.split('/').filter((part) => part !== '');

  // Find the LAST hostname-shaped segment, not the first: redirectors chain, and
  // only the innermost host is the one actually serving the file. The final
  // segment is excluded so a filename like "ep041.mp3" is never read as a host.
  let lastHost = -1;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(segments[index]!)) lastHost = index;
  }

  return lastHost === -1 ? path : segments.slice(lastHost).join('/');
}

/** The last path segment of a URL, percent-decoded, or '' when there is none. */
function lastSegment(raw: string): string {
  const path = unwrapTrackingUrl(raw);
  const segment = path.split('/').filter((part) => part !== '').pop() ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function chooseExtension(kind: AssetKind, candidate: string, contentType: string | null): string {
  const fromUrl = extensionOf(candidate);
  if (fromUrl !== '' && PLAUSIBLE_EXTENSIONS[kind].includes(fromUrl)) return fromUrl;

  if (contentType) {
    const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    const mapped = CONTENT_TYPE_EXTENSIONS[mime];
    if (mapped && PLAUSIBLE_EXTENSIONS[kind].includes(mapped)) return mapped;
  }

  return KIND_DEFAULT_EXTENSION[kind];
}

export interface NamingOptions {
  /** Prefer a name built from the episode title over the one in the URL. */
  preferTitles?: boolean;
  contentType?: string | null;
}

/**
 * Derives the archive-relative path for one discovered URL.
 *
 * The result becomes a permanent hosted URL, so it is built to be readable and
 * stable rather than merely unique: `audio/ep041.mp3`, not `audio/<uuid>.mp3`.
 */
export function relativePathFor(
  reference: UrlReference,
  taken: Set<string>,
  options: NamingOptions = {},
): string {
  if (reference.kind === 'feed') return 'feed.xml';

  const directory = KIND_DIRECTORIES[reference.kind];
  const segment = lastSegment(reference.url);
  const extension = chooseExtension(reference.kind, segment, options.contentType ?? null);

  const urlStem = sanitizeFilename(stemOf(segment), '');
  const titleStem = reference.episodeTitle ? slugify(reference.episodeTitle, '') : '';
  const positional =
    reference.episodeIndex === null ? '' : `ep-${String(reference.episodeIndex).padStart(3, '0')}`;

  let stem: string;
  if (options.preferTitles && titleStem !== '') {
    stem = positional === '' ? titleStem : `${positional}-${titleStem}`;
  } else if (urlStem !== '' && !isOpaqueStem(urlStem)) {
    stem = urlStem;
  } else if (titleStem !== '') {
    stem = positional === '' ? titleStem : `${positional}-${titleStem}`;
  } else if (positional !== '') {
    stem = positional;
  } else {
    stem = reference.kind === 'image' ? 'podcast-cover' : reference.kind;
  }

  // Uniqueness is per directory, so several episodes whose enclosure URLs all end
  // in the same filename still get distinct local paths.
  return `${directory}/${deduplicate(`${stem}${extension}`, taken)}`;
}

/**
 * Builds the per-directory name registries.
 *
 * Names only have to be unique within their own directory, so `images/intro.jpg`
 * and `audio/intro.mp3` do not collide and neither gets an unnecessary `-2`.
 */
export function createNameRegistry(): Map<string, Set<string>> {
  return new Map();
}

export function registryFor(registry: Map<string, Set<string>>, kind: AssetKind): Set<string> {
  const directory = KIND_DIRECTORIES[kind];
  let taken = registry.get(directory);
  if (!taken) {
    taken = new Set<string>();
    registry.set(directory, taken);
  }
  return taken;
}
