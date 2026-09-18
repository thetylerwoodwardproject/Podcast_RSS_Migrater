/**
 * An error whose message is safe to show in the browser.
 *
 * Anything thrown that is not a UserFacingError is reported to the client as a
 * generic failure; the real cause is logged server-side only. Feed contents and
 * filesystem paths must never reach a response body.
 */
export class UserFacingError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(message: string, status = 400, detail?: string) {
    super(message);
    this.name = 'UserFacingError';
    this.status = status;
    this.detail = detail;
  }
}

export const ERROR_MESSAGES = {
  animatedImage: 'Animated or multipage images cannot be converted to a single JPEG.',
  assetTooLarge: 'An asset in this feed is larger than the configured size limit.',
  badBaseUrl: 'The new base URL must be an http(s) URL with no credentials, query or fragment.',
  badFeedUrl: 'The feed URL must be an http(s) URL with no credentials.',
  downloadFailed: 'An asset could not be downloaded. Check the server logs for details.',
  feedUnreadable: 'That feed could not be read as RSS. Check the URL and try again.',
  guidsChanged: 'Episode GUIDs changed during the rewrite. Nothing was delivered.',
  imageVerificationFailed: 'A converted image failed verification and was not kept.',
  jobTooLarge: 'This podcast exceeds the configured total size limit for one job.',
  noAssets: 'No downloadable assets were found in that feed.',
  notFound: 'That job is no longer available. It may have been cleared or expired.',
  privateHost: 'That URL points at a private address, which this server refuses to fetch.',
  publishFailed: 'The SFTP publish failed. Check the server logs for details.',
  serverShuttingDown: 'The server is shutting down and is not accepting new work.',
  tooManyJobs: 'Another job is already running. Wait for it to finish, or delete it.',
  unexpected: 'Something went wrong. Check the server logs for details.',
  unmappedUrl: 'The rewritten feed still references a URL with no local asset.',
  wrongPhase: 'That job is not in a state where this action is possible.',
} as const;
