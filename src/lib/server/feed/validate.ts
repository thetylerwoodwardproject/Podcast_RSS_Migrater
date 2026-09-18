import type { AssetRecord, CheckResult, ValidationReport } from '../../types.js';

/**
 * Collects the validation checks a job runs before anything is delivered.
 *
 * The Python failed on the first problem and printed one line. A web app has
 * room to report everything at once, so each check the script made becomes a row
 * the user can read. Anything that would have aborted the script is a `fail`;
 * anything the app can now correct for itself is a `warn`.
 */
export class ValidationBuilder {
  private readonly checks: CheckResult[] = [];

  add(id: string, label: string, status: CheckResult['status'], detail: string | null = null): void {
    this.checks.push({ id, label, status, detail });
  }

  pass(id: string, label: string, detail: string | null = null): void {
    this.add(id, label, 'pass', detail);
  }

  warn(id: string, label: string, detail: string | null = null): void {
    this.add(id, label, 'warn', detail);
  }

  fail(id: string, label: string, detail: string | null = null): void {
    this.add(id, label, 'fail', detail);
  }

  /** Records a check as passing or failing on a boolean, to keep call sites short. */
  assert(id: string, label: string, condition: boolean, failureDetail: string): void {
    if (condition) this.pass(id, label);
    else this.fail(id, label, failureDetail);
  }

  get hasFailures(): boolean {
    return this.checks.some((check) => check.status === 'fail');
  }

  build(): ValidationReport {
    return {
      checks: this.checks,
      passed: this.checks.filter((check) => check.status === 'pass').length,
      warned: this.checks.filter((check) => check.status === 'warn').length,
      failed: this.checks.filter((check) => check.status === 'fail').length,
      ranAt: Date.now(),
    };
  }
}

export interface UrlValidationContext {
  baseUrl: string;
  /** Archive-relative paths that exist, or are planned to exist, in the workspace. */
  known: Set<string>;
}

export interface UrlProblem {
  url: string;
  reason: 'not-under-base' | 'missing-target';
}

/**
 * Checks that every URL left in the rewritten feed points at a file this archive
 * actually holds.
 *
 * This is the Python's `validate_url()`: a URL that is not under the new base has
 * no local asset behind it, and one that is under the base but names nothing on
 * disk would 404 the moment the feed went live.
 */
export function validateHostedUrls(urls: string[], context: UrlValidationContext): UrlProblem[] {
  const problems: UrlProblem[] = [];

  for (const url of urls) {
    if (!url.startsWith(context.baseUrl)) {
      problems.push({ url, reason: 'not-under-base' });
      continue;
    }

    let relative: string;
    try {
      relative = decodeURIComponent(url.slice(context.baseUrl.length));
    } catch {
      relative = url.slice(context.baseUrl.length);
    }

    if (!context.known.has(relative)) {
      problems.push({ url, reason: 'missing-target' });
    }
  }

  return problems;
}

/** True when any URL in the rewritten feed still points at the source feed's host. */
export function remainingSourceHosts(urls: string[], baseUrl: string): string[] {
  const hosts = new Set<string>();
  for (const url of urls) {
    if (url.startsWith(baseUrl)) continue;
    try {
      hosts.add(new URL(url).host);
    } catch {
      // Not an absolute URL, so it is a relative reference the migration never owned.
    }
  }
  return [...hosts];
}

/** Summarises asset outcomes for the report. */
export function summariseAssets(assets: AssetRecord[]): {
  failed: AssetRecord[];
  skipped: AssetRecord[];
  unresolved: AssetRecord[];
} {
  return {
    failed: assets.filter((asset) => asset.status === 'failed'),
    skipped: assets.filter((asset) => asset.status === 'skipped'),
    unresolved: assets.filter((asset) => asset.status === 'pending' || asset.status === 'downloading'),
  };
}
