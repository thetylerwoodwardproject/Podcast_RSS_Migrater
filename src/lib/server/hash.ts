import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/** Streaming SHA-256 of a file, so multi-gigabyte audio never lands in memory. */
export async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  await pipeline(createReadStream(path, { highWaterMark: 1024 * 1024 }), digest);
  return digest.digest('hex');
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
