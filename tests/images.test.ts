import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { convertToJpeg, isConvertibleImage } from '../src/lib/server/images.js';
import { GENERATED_DIR } from './fixtures/globalSetup.js';

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'migrater-images-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function fixture(name: string): string {
  return join(GENERATED_DIR, name);
}

describe('convertToJpeg', () => {
  it('composites transparency onto white rather than onto black', async () => {
    const target = join(workDir, 'alpha.jpg');
    await convertToJpeg(fixture('alpha.png'), target, 90);

    const pixels = await sharp(target).raw().toBuffer();
    // 50% red over white is (255, 127, 127), give or take JPEG rounding.
    expect(pixels[0]).toBeGreaterThan(240);
    expect(pixels[1]).toBeGreaterThan(110);
    expect(pixels[1]).toBeLessThan(145);
    expect(pixels[2]).toBeGreaterThan(110);
    expect(pixels[2]).toBeLessThan(145);
  });

  it('produces a 3-channel sRGB JPEG', async () => {
    const target = join(workDir, 'opaque.jpg');
    await convertToJpeg(fixture('opaque.png'), target, 90);

    const metadata = await sharp(target).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.channels).toBe(3);
    expect(metadata.space).toBe('srgb');
  });

  it('never resizes', async () => {
    const target = join(workDir, 'same-size.jpg');
    const result = await convertToJpeg(fixture('opaque.png'), target, 90);

    expect(result.width).toBe(32);
    expect(result.height).toBe(16);
  });

  it('bakes in EXIF orientation, swapping the dimensions', async () => {
    // The source is stored 60x30 with orientation 6 (a quarter turn), so the
    // upright result is 30x60. Verification has to compare against the rotated
    // size, not the size sharp reports for the stored pixels.
    const stored = await sharp(fixture('rotated.jpg')).metadata();
    expect(stored.width).toBe(60);
    expect(stored.height).toBe(30);
    expect(stored.orientation).toBe(6);

    const target = join(workDir, 'rotated-out.jpg');
    const result = await convertToJpeg(fixture('rotated.jpg'), target, 90);

    expect(result.width).toBe(30);
    expect(result.height).toBe(60);
  });

  it('refuses an animated image instead of flattening it to one frame', async () => {
    const target = join(workDir, 'animated.jpg');
    await expect(convertToJpeg(fixture('animated.gif'), target, 90)).rejects.toThrow(/animated/i);
  });

  it('honours the quality setting', async () => {
    const low = join(workDir, 'q20.jpg');
    const high = join(workDir, 'q95.jpg');
    const lowResult = await convertToJpeg(fixture('alpha.png'), low, 20);
    const highResult = await convertToJpeg(fixture('alpha.png'), high, 95);

    expect(highResult.bytes).toBeGreaterThan(lowResult.bytes);
  });
});

describe('isConvertibleImage', () => {
  it('accepts every extension the Python treated as artwork', () => {
    for (const path of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.gif', 'a.avif', 'a.tif', 'a.tiff', 'a.bmp', 'a.heic']) {
      expect(isConvertibleImage(path)).toBe(true);
    }
  });

  it('rejects audio, transcripts and chapter documents', () => {
    for (const path of ['a.mp3', 'a.vtt', 'a.json', 'a.xml', 'a']) {
      expect(isConvertibleImage(path)).toBe(false);
    }
  });
});
