import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import sharp from 'sharp';

import { IMAGE_EXTENSIONS } from '../constants.js';
import { ERROR_MESSAGES, UserFacingError } from './errors.js';
import { extensionOf } from './filenames.js';

export function isConvertibleImage(relativePath: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(relativePath));
}

export interface ConversionResult {
  width: number;
  height: number;
  bytes: number;
}

/**
 * Converts one image to JPEG, reproducing the Pillow pipeline the Python used.
 *
 * Point for point: single-frame only, EXIF orientation baked into the pixels,
 * alpha composited onto white, EXIF/ICC/DPI carried across, and -- importantly --
 * no resizing of any kind. The output is then reopened and re-decoded to prove it
 * is a real JPEG before the original can be discarded.
 *
 * Byte-for-byte parity with Pillow is not a goal and is not achievable: libvips
 * and libjpeg-turbo make different encoding choices. Correct format, mode,
 * dimensions, orientation and colour are the contract.
 */
export async function convertToJpeg(
  source: string,
  target: string,
  quality: number,
): Promise<ConversionResult> {
  const metadata = await sharp(source).metadata();

  // `pages` is how libvips reports animated GIF/WebP frames and multipage TIFF.
  if ((metadata.pages ?? 1) > 1) {
    throw new UserFacingError(`${ERROR_MESSAGES.animatedImage} (${source})`);
  }

  const orientation = metadata.orientation ?? 1;
  // sharp reports the stored dimensions, before EXIF rotation is applied. For
  // orientation 5-8 the image is rotated a quarter turn, so the dimensions the
  // output will actually have are swapped. Comparing against the unswapped values
  // would fail verification on every rotated photograph.
  const expected =
    orientation >= 5
      ? { width: metadata.height ?? 0, height: metadata.width ?? 0 }
      : { width: metadata.width ?? 0, height: metadata.height ?? 0 };

  await mkdir(dirname(target), { recursive: true });

  let pipeline = sharp(source, { failOn: 'error' })
    // No argument: take the angle from the EXIF Orientation tag and clear it.
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, progressive: false })
    .keepExif();

  // A CMYK or greyscale ICC profile does not describe the converted RGB pixels,
  // so it is carried across only when the source was already RGB.
  if (metadata.icc && (metadata.space === 'srgb' || metadata.space === 'rgb')) {
    pipeline = pipeline.keepIccProfile();
  }
  if (metadata.density) {
    pipeline = pipeline.withMetadata({ density: metadata.density });
  }

  const info = await pipeline.toFile(target);

  // Reopen and fully decode the result before any original is deleted.
  const written = await sharp(target).metadata();
  if (
    written.format !== 'jpeg' ||
    written.width !== expected.width ||
    written.height !== expected.height
  ) {
    throw new UserFacingError(`${ERROR_MESSAGES.imageVerificationFailed} (${source})`);
  }

  return { width: info.width, height: info.height, bytes: info.size };
}

let formatCache: string[] | null = null;

/**
 * Image formats this server's libvips build can actually decode.
 *
 * The prebuilt binary does not always include every codec -- HEIC in particular is
 * often left out -- so this is reported at `/api/health` and an undecodable asset
 * fails on its own rather than taking the job down with it.
 */
export function supportedImageFormats(): string[] {
  formatCache ??= Object.entries(sharp.format)
    .filter(([, value]) => value.input.file)
    .map(([name]) => name)
    .sort();
  return formatCache;
}

export function canDecode(relativePath: string): boolean {
  const extension = extensionOf(relativePath);
  const formats = supportedImageFormats();

  const required: Record<string, string> = {
    '.jpg': 'jpeg',
    '.jpeg': 'jpeg',
    '.png': 'png',
    '.webp': 'webp',
    '.gif': 'gif',
    '.tif': 'tiff',
    '.tiff': 'tiff',
    '.avif': 'heif',
    '.heic': 'heif',
    '.bmp': 'magick',
  };

  const needed = required[extension];
  // An unknown extension is not this function's to refuse; conversion will fail
  // with a real message if it turns out not to be an image at all.
  if (!needed) return true;
  if (needed === 'magick') return formats.includes('magick') || formats.includes('bmp');
  return formats.includes(needed);
}
