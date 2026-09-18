import { describe, expect, it } from 'vitest';

import { rewriteChapters } from '../src/lib/server/chapters.js';
import { buildReplacer } from '../src/lib/server/feed/rewrite.js';

const replace = buildReplacer(
  new Map([['https://old.example.com/a.jpg', 'https://cdn.example.com/chapters/images/a.jpg']]),
);

describe('rewriteChapters', () => {
  it('rewrites img and reports it', () => {
    const source = JSON.stringify(
      { version: '1.2.0', chapters: [{ startTime: 0, img: 'https://old.example.com/a.jpg' }] },
      null,
      2,
    );
    const result = rewriteChapters(source, replace, 'chapters/ep1.json');

    expect(result.text).toContain('https://cdn.example.com/chapters/images/a.jpg');
    expect(result.imageUrls).toEqual(['https://cdn.example.com/chapters/images/a.jpg']);
  });

  it('does not treat a chapter url as an asset to validate', () => {
    // `url` is a website link, so it is never downloaded and never appears in
    // imageUrls -- only `img` is validated against the archive.
    const source = JSON.stringify({ chapters: [{ startTime: 0, url: 'https://blog.example.com/post' }] });
    const result = rewriteChapters(source, replace, 'chapters/ep1.json');
    expect(result.imageUrls).toEqual([]);
    expect(result.text).toBeNull();
  });

  it('still rewrites a chapter url that names a migrated asset', () => {
    // The substitution is document-wide by design. A link pointing at an asset
    // that just moved should follow it rather than 404.
    const source = JSON.stringify({ chapters: [{ startTime: 0, url: 'https://old.example.com/a.jpg' }] });
    const result = rewriteChapters(source, replace, 'chapters/ep1.json');
    expect(result.text).toContain('https://cdn.example.com/chapters/images/a.jpg');
    expect(result.imageUrls).toEqual([]);
  });

  it('returns null when nothing changed, so the file is not rewritten', () => {
    const source = JSON.stringify({ chapters: [{ startTime: 0, title: 'Intro' }] });
    expect(rewriteChapters(source, replace, 'chapters/ep1.json').text).toBeNull();
  });

  it('preserves formatting outside the replaced URLs', () => {
    // Raw-text substitution, not parse-and-reserialize: indentation and key order
    // survive, which matters for a file that may be served with a strong ETag.
    const source = '{\n    "chapters": [ { "img": "https://old.example.com/a.jpg" } ]\n}';
    const result = rewriteChapters(source, replace, 'chapters/ep1.json');
    expect(result.text).toBe(
      '{\n    "chapters": [ { "img": "https://cdn.example.com/chapters/images/a.jpg" } ]\n}',
    );
  });

  it('rejects a rewrite that produced invalid JSON', () => {
    expect(() => rewriteChapters('{not json', replace, 'chapters/ep1.json')).toThrow(/invalid JSON/);
  });

  it('tolerates a document with no chapters array', () => {
    const result = rewriteChapters('{"version":"1.2.0"}', replace, 'chapters/ep1.json');
    expect(result.imageUrls).toEqual([]);
  });
});
