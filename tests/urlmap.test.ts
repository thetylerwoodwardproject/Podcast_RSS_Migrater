import { describe, expect, it } from 'vitest';

import { hostedUrl, quotePath, UrlMap } from '../src/lib/server/feed/urlmap.js';

describe('quotePath', () => {
  /**
   * Expected values come from Python's `urllib.parse.quote(path, safe='/')`,
   * which is what the CLI used to build hosted URLs.
   *
   * This matters because the encoded path is simultaneously the URL written into
   * the feed and the object key uploaded to the host. `encodeURIComponent` alone
   * disagrees with Python on `! * ' ( )`, so a show with a parenthesis in a
   * filename would end up with a feed pointing at a key that was never created.
   */
  const cases: [string, string][] = [
    ['audio/ep041.mp3', 'audio/ep041.mp3'],
    ['audio/My Show (Live)!.mp3', 'audio/My%20Show%20%28Live%29%21.mp3'],
    ['images/café.jpg', 'images/caf%C3%A9.jpg'],
    ["a/b'c*d.mp3", 'a/b%27c%2Ad.mp3'],
    ['audio/100% done.mp3', 'audio/100%25%20done.mp3'],
    ['chapters/ep~1_v2.0.json', 'chapters/ep~1_v2.0.json'],
    ['a&b/c+d.mp3', 'a%26b/c%2Bd.mp3'],
  ];

  for (const [input, expected] of cases) {
    it(`encodes ${JSON.stringify(input)} the way Python does`, () => {
      expect(quotePath(input)).toBe(expected);
    });
  }

  it('never escapes the path separator', () => {
    expect(quotePath('a/b/c/d.mp3')).toBe('a/b/c/d.mp3');
  });
});

describe('hostedUrl', () => {
  it('concatenates the base and the encoded path', () => {
    expect(hostedUrl('https://cdn.example.com/podcast/', 'audio/ep041.mp3')).toBe(
      'https://cdn.example.com/podcast/audio/ep041.mp3',
    );
  });
});

describe('UrlMap', () => {
  it('records a mapping', () => {
    const map = new UrlMap();
    map.add('http://old/a', 'http://new/a');
    expect(map.get('http://old/a')).toBe('http://new/a');
  });

  it('ignores a null or empty source URL', () => {
    const map = new UrlMap();
    map.add(null, 'http://new/a');
    map.add('', 'http://new/a');
    expect(map.size).toBe(0);
  });

  it('accepts the same mapping twice', () => {
    const map = new UrlMap();
    map.add('http://old/a', 'http://new/a');
    expect(() => map.add('http://old/a', 'http://new/a')).not.toThrow();
    expect(map.size).toBe(1);
  });

  it('refuses one source URL mapping to two different files', () => {
    // The feed could not be rewritten unambiguously, which the CLI also treated
    // as fatal rather than picking one.
    const map = new UrlMap();
    map.add('http://old/a', 'http://new/a');
    expect(() => map.add('http://old/a', 'http://new/b')).toThrow(/two different files/);
  });
});
