import { describe, expect, it } from 'vitest';

import { chapterImageUrls, channelCoverUrls, discoverUrls } from '../src/lib/server/feed/discover.js';
import { channelTitle, guids, items, parseFeed } from '../src/lib/server/feed/xmlnodes.js';

/**
 * The prefixes here are deliberately non-standard: `itun:` instead of `itunes:`
 * and `pi:` instead of `podcast:`.
 *
 * Feeds are free to bind any prefix to a namespace, so matching on the literal
 * string "itunes:image" would silently miss every piece of artwork in a feed like
 * this one. Discovery resolves prefixes to namespace URIs first.
 */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="https://old.example.com/style.xsl"?>
<rss version="2.0"
     xmlns:itun="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:pi="https://podcastindex.org/namespace/1.0"
     xmlns:psc="http://podlove.org/simple-chapters">
  <channel>
    <title>Fixture Show</title>
    <link>https://old.example.com/</link>
    <atom:link rel="self" href="https://old.example.com/feed.xml"/>
    <atom:link rel="hub" href="https://hub.example.com/"/>
    <atom:link rel="alternate" href="https://alt.example.com/"/>
    <itun:image href="https://old.example.com/images/cover.png"/>
    <image><url>https://old.example.com/images/cover2.png</url></image>
    <pi:funding url="https://donate.example.com/">Support</pi:funding>
    <pi:person img="https://old.example.com/images/host.jpg">A Host</pi:person>
    <item>
      <title>Episode One</title>
      <guid>guid-1</guid>
      <enclosure url="https://old.example.com/audio/ep1.mp3" length="10" type="audio/mpeg"/>
      <itun:image href="https://old.example.com/images/ep1.png"/>
      <pi:transcript url="https://old.example.com/t/ep1.vtt" type="text/vtt"/>
      <pi:chapters url="https://old.example.com/c/ep1.json" type="application/json+chapters"/>
      <psc:chapters>
        <psc:chapter start="00:00:00" title="Intro" image="https://old.example.com/images/psc1.png"/>
      </psc:chapters>
    </item>
    <item>
      <title>Episode Two</title>
      <guid>guid-2</guid>
      <enclosure url="https://old.example.com/audio/ep2.mp3" length="20" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

const doc = parseFeed(FEED);
const found = discoverUrls(doc);
const urls = found.map((reference) => reference.url);

describe('parseFeed', () => {
  it('reads the channel title', () => {
    expect(channelTitle(doc)).toBe('Fixture Show');
  });

  it('finds the items', () => {
    expect(items(doc)).toHaveLength(2);
  });

  it('reads the GUIDs in document order', () => {
    expect(guids(doc)).toEqual(['guid-1', 'guid-2']);
  });

  it('rejects something that is not an RSS document', () => {
    expect(() => parseFeed('<html><body>not a feed</body></html>')).toThrow();
  });

  it('rejects an rss element with no channel', () => {
    expect(() => parseFeed('<rss version="2.0"></rss>')).toThrow();
  });
});

describe('discoverUrls', () => {
  it('finds itunes:image despite the non-standard prefix', () => {
    expect(urls).toContain('https://old.example.com/images/cover.png');
    expect(urls).toContain('https://old.example.com/images/ep1.png');
  });

  it('finds every enclosure', () => {
    expect(urls).toContain('https://old.example.com/audio/ep1.mp3');
    expect(urls).toContain('https://old.example.com/audio/ep2.mp3');
  });

  it('finds the transcript and chapters URLs', () => {
    expect(urls).toContain('https://old.example.com/t/ep1.vtt');
    expect(urls).toContain('https://old.example.com/c/ep1.json');
  });

  it('finds a psc:chapter image', () => {
    expect(urls).toContain('https://old.example.com/images/psc1.png');
  });

  it('finds the channel image URL element', () => {
    expect(urls).toContain('https://old.example.com/images/cover2.png');
  });

  it('finds the atom self link', () => {
    expect(urls).toContain('https://old.example.com/feed.xml');
  });

  // The README states these are left alone, so each is asserted rather than assumed.
  it.each([
    ['the hub link', 'https://hub.example.com/'],
    ['the alternate link', 'https://alt.example.com/'],
    ['the website link', 'https://old.example.com/'],
    ['a funding URL', 'https://donate.example.com/'],
    ['a person image', 'https://old.example.com/images/host.jpg'],
    ['the XSL stylesheet', 'https://old.example.com/style.xsl'],
  ])('leaves %s alone', (_label, url) => {
    expect(urls).not.toContain(url);
  });

  it('attributes episode assets to their GUID', () => {
    const audio = found.find((reference) => reference.url.endsWith('ep1.mp3'));
    expect(audio?.episodeGuid).toBe('guid-1');
    expect(audio?.episodeTitle).toBe('Episode One');
    expect(audio?.episodeIndex).toBe(1);
  });

  it('leaves channel-level assets unattributed', () => {
    const cover = found.find((reference) => reference.url.endsWith('cover.png'));
    expect(cover?.episodeGuid).toBeNull();
  });

  it('labels each reference with the right kind', () => {
    const kindOf = (suffix: string): string | undefined =>
      found.find((reference) => reference.url.endsWith(suffix))?.kind;

    expect(kindOf('ep1.mp3')).toBe('audio');
    expect(kindOf('ep1.png')).toBe('image');
    expect(kindOf('ep1.vtt')).toBe('transcript');
    expect(kindOf('ep1.json')).toBe('chapters');
    expect(kindOf('psc1.png')).toBe('chapter-image');
    expect(kindOf('feed.xml')).toBe('feed');
  });
});

describe('channelCoverUrls', () => {
  it('returns both cover forms, deduplicated', () => {
    expect(channelCoverUrls(doc)).toEqual([
      'https://old.example.com/images/cover.png',
      'https://old.example.com/images/cover2.png',
    ]);
  });
});

describe('chapterImageUrls', () => {
  it('collects img but not url', () => {
    // `url` is a website link for the listener, not an asset this tool hosts.
    const json = {
      chapters: [
        { startTime: 0, img: 'https://old.example.com/a.jpg' },
        { startTime: 1, url: 'https://blog.example.com/post' },
        { startTime: 2 },
      ],
    };
    expect(chapterImageUrls(json)).toEqual(['https://old.example.com/a.jpg']);
  });

  it('tolerates a document with no chapters array', () => {
    expect(chapterImageUrls({})).toEqual([]);
    expect(chapterImageUrls(null)).toEqual([]);
    expect(chapterImageUrls({ chapters: 'nope' })).toEqual([]);
  });
});
