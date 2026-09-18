export const APP_NAME = 'Podcast RSS Migrater';
export const APP_TAGLINE = 'Archive a podcast from its feed and move it to new hosting.';

/**
 * XML namespace URIs, matching the Clark-notation constants the Python used.
 *
 * Every lookup in the feed is by URI, never by prefix: a feed is free to declare
 * `xmlns:itun="http://www.itunes.com/dtds/podcast-1.0.dtd"` and matching on the
 * string "itunes:image" would silently miss all of its artwork.
 */
export const NS = {
  itunes: 'http://www.itunes.com/dtds/podcast-1.0.dtd',
  atom: 'http://www.w3.org/2005/Atom',
  podcast: 'https://podcastindex.org/namespace/1.0',
  psc: 'http://podlove.org/simple-chapters',
  content: 'http://purl.org/rss/1.0/modules/content/',
} as const;

/** Extensions treated as convertible artwork, matching the Python's IMAGE_EXTENSIONS. */
export const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.tif',
  '.tiff',
  '.bmp',
  '.heic',
] as const;

/** Directory each asset kind is archived into. Fixed by the hosted-URL layout. */
export const KIND_DIRECTORIES = {
  audio: 'audio',
  image: 'images',
  'chapter-image': 'chapters/images',
  chapters: 'chapters',
  transcript: 'transcripts',
  feed: '',
} as const;

/** Extension used when neither the URL nor the Content-Type gives a usable one. */
export const KIND_DEFAULT_EXTENSION = {
  audio: '.mp3',
  image: '.jpg',
  'chapter-image': '.jpg',
  chapters: '.json',
  transcript: '.vtt',
  feed: '.xml',
} as const;

/** Content-Type to extension, used when a URL carries no usable extension of its own. */
export const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/tiff': '.tif',
  'image/bmp': '.bmp',
  'image/heic': '.heic',
  'image/heif': '.heic',
  'application/json': '.json',
  'application/json+chapters': '.json',
  'text/vtt': '.vtt',
  'text/srt': '.srt',
  'application/x-subrip': '.srt',
  'text/html': '.html',
  'text/plain': '.txt',
  'application/pdf': '.pdf',
};

/** Largest chapters JSON or feed document fetched as text, in bytes. */
export const MAX_TEXT_DOCUMENT_BYTES = 32 * 1024 * 1024;

export const PHASE_LABELS = {
  discovering: 'Reading the feed',
  planned: 'Ready to start',
  downloading: 'Downloading assets',
  converting: 'Converting artwork',
  rewriting: 'Rewriting URLs',
  ready: 'Ready to deliver',
  publishing: 'Publishing over SFTP',
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const;
