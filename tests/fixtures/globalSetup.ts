import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

export const GENERATED_DIR = join(dirname(fileURLToPath(import.meta.url)), 'generated');

/**
 * A minimal two-frame GIF89a, written byte by byte.
 *
 * sharp cannot author a multi-page image, so the one fixture that has to be
 * animated is assembled by hand. It is a 1x1 pixel repeated twice, which is
 * enough for `metadata().pages` to report 2 and for the conversion guard to fire.
 */
function animatedGif(): Buffer {
  const frame = [
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, // graphic control extension
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // 1x1 image descriptor
    0x02, 0x02, 0x44, 0x01, 0x00, // LZW: min code size 2, then clear / pixel 0 / end
  ];

  return Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
    0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, // 1x1, 2-entry global colour table
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff, // black, white
    ...frame,
    ...frame,
    0x3b, // trailer
  ]);
}

/**
 * Image fixtures are generated rather than committed.
 *
 * Binary test data rots in a repository: nobody can review a diff of it, and a
 * JPEG carrying a specific EXIF orientation is far clearer as three lines of
 * sharp than as an opaque blob. AirFLAC generates its audio fixtures the same way.
 */
export async function setup(): Promise<void> {
  await rm(GENERATED_DIR, { recursive: true, force: true });
  await mkdir(GENERATED_DIR, { recursive: true });

  // Half-transparent red, for the alpha-composited-onto-white check.
  await sharp({
    create: { width: 40, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
  })
    .png()
    .toFile(join(GENERATED_DIR, 'alpha.png'));

  // Opaque, for the baseline path.
  await sharp({
    create: { width: 32, height: 16, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toFile(join(GENERATED_DIR, 'opaque.png'));

  // EXIF orientation 6 is a quarter turn, so this 60x30 source must come out
  // 30x60. sharp reports the stored (pre-rotation) dimensions, which is exactly
  // the trap a naive verification step falls into.
  await sharp({
    create: { width: 60, height: 30, channels: 3, background: { r: 0, g: 200, b: 0 } },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toFile(join(GENERATED_DIR, 'rotated.jpg'));

  await writeFile(join(GENERATED_DIR, 'animated.gif'), animatedGif());
}
