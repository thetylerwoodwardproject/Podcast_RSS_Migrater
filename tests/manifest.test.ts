import { describe, expect, it } from 'vitest';

import type { AssetRecord } from '../src/lib/types.js';
import {
  alreadyProcessed,
  buildManifest,
  readManifest,
  serializeManifest,
} from '../src/lib/server/manifest.js';

function asset(partial: Partial<AssetRecord> & Pick<AssetRecord, 'id' | 'kind' | 'relativePath'>): AssetRecord {
  return {
    sourceUrl: `https://old.example.com/${partial.relativePath}`,
    resolvedUrl: null,
    hostedUrl: `https://cdn.example.com/${partial.relativePath}`,
    status: 'downloaded',
    bytes: 100,
    expectedBytes: null,
    sha256: 'abc',
    contentType: null,
    replacedBy: null,
    episodeGuid: null,
    error: null,
    ...partial,
  };
}

const manifest = buildManifest({
  version: '1.0.0',
  title: 'Fixture Show',
  feedUrl: 'https://old.example.com/feed.xml',
  baseUrl: 'https://cdn.example.com/',
  hostedFeedUrl: 'https://cdn.example.com/feed.xml',
  assets: [
    asset({ id: '1', kind: 'feed', relativePath: 'feed.xml', status: 'skipped' }),
    asset({ id: '2', kind: 'image', relativePath: 'images/cover.jpg', contentType: 'image/jpeg' }),
    asset({ id: '3', kind: 'audio', relativePath: 'audio/ep1.mp3', episodeGuid: 'guid-1' }),
  ],
  episodeTitles: new Map([['guid-1', 'Episode One']]),
  jpegProcessing: { 'images/cover.jpg': { quality: 85, sha256: 'abc' } },
});

describe('buildManifest', () => {
  it('separates the feed, channel assets and episode assets', () => {
    expect(manifest.feeds.map((record) => record.file)).toEqual(['feed.xml']);
    expect(manifest.assets.map((record) => record.file)).toEqual(['images/cover.jpg']);
    expect(manifest.episodes).toHaveLength(1);
    expect(manifest.episodes[0]?.guid).toBe('guid-1');
    expect(manifest.episodes[0]?.title).toBe('Episode One');
    expect(manifest.episodes[0]?.assets.map((record) => record.file)).toEqual(['audio/ep1.mp3']);
  });

  it('records the hosted URL, size, hash and content type per asset', () => {
    const cover = manifest.assets[0]!;
    expect(cover.hosted_url).toBe('https://cdn.example.com/images/cover.jpg');
    expect(cover.bytes).toBe(100);
    expect(cover.sha256).toBe('abc');
    expect(cover.content_type).toBe('image/jpeg');
  });

  it('keeps the original URL alongside the hosted one', () => {
    // The point of the manifest is that the migration is reversible and auditable.
    expect(manifest.assets[0]?.url).toBe('https://old.example.com/images/cover.jpg');
  });

  it('records the feed URLs at the top level', () => {
    expect(manifest.feed_url).toBe('https://old.example.com/feed.xml');
    expect(manifest.hosted_feed_url).toBe('https://cdn.example.com/feed.xml');
  });
});

describe('serializeManifest and readManifest', () => {
  it('round-trips', () => {
    const parsed = readManifest(serializeManifest(manifest));
    expect(parsed.title).toBe('Fixture Show');
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.jpeg_processing['images/cover.jpg']?.quality).toBe(85);
  });

  it('ends with a newline, as the CLI wrote it', () => {
    expect(serializeManifest(manifest).endsWith('\n')).toBe(true);
  });

  it('names the offending record when one has no file field', () => {
    // The CLI raised a bare KeyError here, which surfaced to the user as
    // "Error: 'file'" with no indication of which record was wrong.
    const broken = JSON.stringify({ assets: [{ url: 'https://x/a.mp3' }] });
    expect(() => readManifest(broken)).toThrow(/assets\[0\] has no "file" field/);
  });

  it('rejects malformed JSON with a readable message', () => {
    expect(() => readManifest('{not json')).toThrow(/not valid JSON/);
  });

  it('tolerates a manifest missing optional sections', () => {
    const parsed = readManifest('{"feed_url":"https://x/feed.xml"}');
    expect(parsed.assets).toEqual([]);
    expect(parsed.episodes).toEqual([]);
  });
});

describe('alreadyProcessed', () => {
  const memo = { 'images/a.jpg': { quality: 90, sha256: 'hash-1' } };

  it('skips an image converted at the same quality from the same bytes', () => {
    expect(alreadyProcessed(memo, 'images/a.jpg', 90, 'hash-1')).toBe(true);
  });

  it('reconverts when the quality changed', () => {
    expect(alreadyProcessed(memo, 'images/a.jpg', 85, 'hash-1')).toBe(false);
  });

  it('reconverts when the file changed', () => {
    expect(alreadyProcessed(memo, 'images/a.jpg', 90, 'hash-2')).toBe(false);
  });

  it('converts an image it has never seen', () => {
    expect(alreadyProcessed(memo, 'images/b.jpg', 90, 'hash-1')).toBe(false);
  });
});
