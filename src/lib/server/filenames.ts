const MAX_FILENAME_LENGTH = 180;

/**
 * Drops control characters.
 *
 * They are never meaningful in a filename and a stray one would survive into a
 * Content-Disposition header. Done by code point rather than a regular
 * expression so no control byte has to appear in this file.
 */
function stripControlCharacters(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += char;
  }
  return out;
}

/**
 * Reduces a URL-derived or feed-derived name to a safe single path segment.
 *
 * The result reaches Content-Disposition headers, ZIP entry names and on-disk
 * paths, so every path separator is removed rather than escaped: it can never be
 * interpreted as a path, relative or absolute.
 */
export function sanitizeFilename(input: string, fallback = 'file'): string {
  let name = input.normalize('NFC');

  // Take the last path segment, treating both separator styles as hostile input.
  const lastSeparator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSeparator !== -1) name = name.slice(lastSeparator + 1);

  name = stripControlCharacters(name)
    .replace(/[<>:"|?*\\/]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  // A name of only dots would resolve to the current or parent directory.
  name = name.replace(/^\.+/, '').replace(/\.+$/, '').trim();

  if (name.length > MAX_FILENAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot, dot + 12) : '';
    name = name.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
  }

  return name === '' ? fallback : name;
}

/** Lowercase, hyphenated form suitable for a filename stem derived from a title. */
export function slugify(input: string, fallback = 'item'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug === '' ? fallback : slug;
}

export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{1,12})$/i.exec(filename);
  return match?.[1] ? `.${match[1].toLowerCase()}` : '';
}

export function stemOf(filename: string): string {
  const extension = extensionOf(filename);
  return extension === '' ? filename : filename.slice(0, -extension.length);
}

/** Swaps a filename's extension, e.g. "ep041.png" -> "ep041.jpg". */
export function replaceExtension(filename: string, extension: string): string {
  const dotted = extension.startsWith('.') ? extension : `.${extension}`;
  return `${stemOf(filename)}${dotted}`;
}

/**
 * Makes `candidate` unique against names already in `taken`, so two episodes whose
 * enclosure URLs end in the same filename still produce two distinct local files.
 */
export function deduplicate(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) {
    taken.add(candidate);
    return candidate;
  }

  const extension = extensionOf(candidate);
  const base = stemOf(candidate);

  for (let counter = 2; ; counter += 1) {
    const next = `${base}-${counter}${extension}`;
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
}
