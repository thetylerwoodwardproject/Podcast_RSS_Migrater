import { describe, expect, it } from 'vitest';

import type { UrlReference } from '../src/lib/server/feed/discover.js';
import {
  createNameRegistry,
  registryFor,
  relativePathFor,
  unwrapTrackingUrl,
} from '../src/lib/server/feed/naming.js';

function reference(partial: Partial<UrlReference> & Pick<UrlReference, 'url' | 'kind'>): UrlReference {
  return { episodeGuid: null, episodeTitle: null, episodeIndex: null, ...partial };
}

describe('unwrapTrackingUrl', () => {
  it('digs the real path out of a chained redirector', () => {
    expect(
      unwrapTrackingUrl('https://chrt.fm/track/ABC/pdst.fm/e/cdn.example.com/ep041.mp3'),
    ).toBe('cdn.example.com/ep041.mp3');
  });

  it('leaves an ordinary URL alone', () => {
    expect(unwrapTrackingUrl('https://cdn.example.com/audio/ep041.mp3')).toBe('/audio/ep041.mp3');
  });
});

describe('relativePathFor', () => {
  const taken = (): Set<string> => new Set<string>();

  it('files each kind in its own directory', () => {
    expect(relativePathFor(reference({ url: 'https://x/a.mp3', kind: 'audio' }), taken()))
      .toBe('audio/a.mp3');
    expect(relativePathFor(reference({ url: 'https://x/a.png', kind: 'image' }), taken()))
      .toBe('images/a.png');
    expect(relativePathFor(reference({ url: 'https://x/a.json', kind: 'chapters' }), taken()))
      .toBe('chapters/a.json');
    expect(relativePathFor(reference({ url: 'https://x/a.vtt', kind: 'transcript' }), taken()))
      .toBe('transcripts/a.vtt');
    expect(relativePathFor(reference({ url: 'https://x/a.png', kind: 'chapter-image' }), taken()))
      .toBe('chapters/images/a.png');
  });

  it('always names the feed feed.xml', () => {
    expect(relativePathFor(reference({ url: 'https://x/rss', kind: 'feed' }), taken())).toBe('feed.xml');
  });

  it('takes the extension from the URL when it suits the kind', () => {
    expect(relativePathFor(reference({ url: 'https://x/a.flac', kind: 'audio' }), taken()))
      .toBe('audio/a.flac');
  });

  it('falls back to the content type when the URL has no usable extension', () => {
    expect(
      relativePathFor(reference({ url: 'https://x/download', kind: 'audio' }), taken(), {
        contentType: 'audio/mp4; codecs=mp4a',
      }),
    ).toBe('audio/download.m4a');
  });

  it('falls back to the kind default when neither helps', () => {
    expect(relativePathFor(reference({ url: 'https://x/download', kind: 'audio' }), taken()))
      .toBe('audio/download.mp3');
  });

  it('ignores an extension that does not suit the kind', () => {
    // A .php endpoint serving audio must not produce audio/x.php.
    expect(relativePathFor(reference({ url: 'https://x/stream.php', kind: 'audio' }), taken()))
      .toBe('audio/stream.mp3');
  });

  it('deduplicates colliding names within a directory', () => {
    const registry = taken();
    const first = relativePathFor(reference({ url: 'https://a/intro.mp3', kind: 'audio' }), registry);
    const second = relativePathFor(reference({ url: 'https://b/intro.mp3', kind: 'audio' }), registry);
    expect(first).toBe('audio/intro.mp3');
    // A hyphen rather than " (2)": these become URLs, and a space would be
    // percent-encoded into the hosted path forever.
    expect(second).toBe('audio/intro-2.mp3');
  });

  it('keeps directories independent, so no needless suffix appears', () => {
    const registry = createNameRegistry();
    const audio = relativePathFor(
      reference({ url: 'https://x/intro.mp3', kind: 'audio' }),
      registryFor(registry, 'audio'),
    );
    const image = relativePathFor(
      reference({ url: 'https://x/intro.png', kind: 'image' }),
      registryFor(registry, 'image'),
    );
    expect(audio).toBe('audio/intro.mp3');
    expect(image).toBe('images/intro.png');
  });

  it('percent-decodes the URL segment', () => {
    expect(relativePathFor(reference({ url: 'https://x/My%20Show.mp3', kind: 'audio' }), taken()))
      .toBe('audio/My Show.mp3');
  });

  it('strips path separators smuggled into a URL segment', () => {
    const path = relativePathFor(
      reference({ url: 'https://x/%2e%2e%2f%2e%2e%2fetc%2fpasswd.mp3', kind: 'audio' }),
      taken(),
    );
    expect(path.startsWith('audio/')).toBe(true);
    expect(path).not.toContain('..');
    expect(path.split('/')).toHaveLength(2);
  });

  it('falls back to the episode title when the URL stem is an opaque hash', () => {
    const path = relativePathFor(
      reference({
        url: 'https://cdn.x/a/8f3c1e9bd47f2a6c.mp3',
        kind: 'audio',
        episodeTitle: 'The Big Interview',
        episodeIndex: 41,
      }),
      taken(),
    );
    expect(path).toBe('audio/ep-041-the-big-interview.mp3');
  });

  it('prefers titles when asked to', () => {
    const path = relativePathFor(
      reference({ url: 'https://x/ep041.mp3', kind: 'audio', episodeTitle: 'Hello World', episodeIndex: 41 }),
      taken(),
      { preferTitles: true },
    );
    expect(path).toBe('audio/ep-041-hello-world.mp3');
  });

  it('names a lone channel cover podcast-cover.jpg', () => {
    expect(relativePathFor(reference({ url: 'https://x/', kind: 'image' }), taken()))
      .toBe('images/podcast-cover.jpg');
  });
});
