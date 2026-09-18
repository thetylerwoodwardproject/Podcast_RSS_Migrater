let acceptingWork = true;

/** False once shutdown has begun, so no new jobs or downloads are started. */
export function isAcceptingWork(): boolean {
  return acceptingWork;
}

export function stopAcceptingWork(): void {
  acceptingWork = false;
}

/** Test seam. */
export function resumeAcceptingWork(): void {
  acceptingWork = true;
}
