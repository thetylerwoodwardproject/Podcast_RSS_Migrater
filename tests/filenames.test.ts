import { describe, expect, it } from 'vitest';

import {
  deduplicate,
  extensionOf,
  replaceExtension,
  sanitizeFilename,
  slugify,
  stemOf,
} from '../src/lib/server/filenames.js';

describe('sanitizeFilename', () => {
  it('keeps an ordinary name', () => {
    expect(sanitizeFilename('Morning Promo.mp3')).toBe('Morning Promo.mp3');
  });

  it('reduces a path to its last segment', () => {
    // The result reaches Content-Disposition headers and ZIP entry names, so it
    // must never be interpretable as a path.
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Windows\\evil.mp3')).toBe('evil.mp3');
  });

  it('strips control characters', () => {
    expect(sanitizeFilename('a\u0000b\u001fc\u007f.mp3')).toBe('abc.mp3');
  });

  it('replaces characters that are illegal in a filename', () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h.mp3')).toBe('a_b_c_d_e_f_g_h.mp3');
  });

  it('strips leading and trailing dots', () => {
    expect(sanitizeFilename('...hidden...')).toBe('hidden');
    expect(sanitizeFilename('..')).toBe('file');
    expect(sanitizeFilename('.')).toBe('file');
  });

  it('falls back when nothing usable remains', () => {
    expect(sanitizeFilename('', 'fallback')).toBe('fallback');
    expect(sanitizeFilename('///')).toBe('file');
  });

  it('truncates a very long name but keeps its extension', () => {
    const result = sanitizeFilename(`${'a'.repeat(400)}.mp3`);
    expect(result.length).toBeLessThanOrEqual(180);
    expect(result.endsWith('.mp3')).toBe(true);
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('The Big Interview!')).toBe('the-big-interview');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Del Mar')).toBe('cafe-del-mar');
  });

  it('falls back when nothing survives', () => {
    expect(slugify('!!!', 'item')).toBe('item');
  });
});

describe('extensionOf and stemOf', () => {
  it('splits a name', () => {
    expect(extensionOf('ep041.mp3')).toBe('.mp3');
    expect(stemOf('ep041.mp3')).toBe('ep041');
  });

  it('lowercases the extension', () => {
    expect(extensionOf('EP041.MP3')).toBe('.mp3');
  });

  it('handles a name with no extension', () => {
    expect(extensionOf('ep041')).toBe('');
    expect(stemOf('ep041')).toBe('ep041');
  });

  it('keeps dots inside the stem', () => {
    expect(stemOf('ep.041.v2.mp3')).toBe('ep.041.v2');
  });
});

describe('replaceExtension', () => {
  it('swaps the extension', () => {
    expect(replaceExtension('images/ep041.png', '.jpg')).toBe('images/ep041.jpg');
    expect(replaceExtension('ep041.png', 'jpg')).toBe('ep041.jpg');
  });

  it('appends when there was no extension', () => {
    expect(replaceExtension('cover', '.jpg')).toBe('cover.jpg');
  });
});

describe('deduplicate', () => {
  it('leaves the first name alone', () => {
    expect(deduplicate('a.mp3', new Set())).toBe('a.mp3');
  });

  it('suffixes collisions with a hyphen, not a space', () => {
    // These become URL path segments, so a space would be percent-encoded into
    // the hosted path permanently.
    const taken = new Set<string>();
    expect(deduplicate('a.mp3', taken)).toBe('a.mp3');
    expect(deduplicate('a.mp3', taken)).toBe('a-2.mp3');
    expect(deduplicate('a.mp3', taken)).toBe('a-3.mp3');
  });

  it('handles a name with no extension', () => {
    const taken = new Set(['a']);
    expect(deduplicate('a', taken)).toBe('a-2');
  });
});
