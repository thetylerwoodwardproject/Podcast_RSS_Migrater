import { realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { UserFacingError } from './errors.js';
import { isValidId } from './id.js';

/**
 * Joins a workspace-relative path onto its root, refusing anything that could
 * escape it.
 *
 * This is a security boundary, not a convenience. Relative paths here are derived
 * from feed contents and from a manifest, both of which are attacker-controlled
 * when someone migrates a feed they do not own. Ported from the Python
 * `checked_path()`, with the same three rejections: absolute paths, any `..`
 * segment, and a resolved path outside the root (which also catches a symlink
 * pointing out of the tree).
 */
export function safeJoin(root: string, relative: string): string {
  if (relative === '' || isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) {
    throw new UserFacingError(`Unsafe relative path: ${relative}`);
  }

  const segments = relative.split(/[/\\]/);
  if (segments.some((part) => part === '..' || part === '.' || part === '')) {
    throw new UserFacingError(`Unsafe relative path: ${relative}`);
  }
  // A NUL byte truncates the path at the syscall boundary, so "a\0/../../etc" would
  // pass the segment check above and still escape.
  if (relative.includes('\0')) {
    throw new UserFacingError(`Unsafe relative path: ${relative}`);
  }

  const rootResolved = resolve(root);
  const target = resolve(rootResolved, ...segments);
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
    throw new UserFacingError(`Path escapes the workspace: ${relative}`);
  }

  // Follow symlinks for whichever prefix of the path already exists. A link planted
  // inside the workspace could otherwise redirect a write outside it.
  let existing = target;
  for (;;) {
    let real: string;
    try {
      real = realpathSync(existing);
    } catch {
      const parent = resolve(existing, '..');
      // Reached the filesystem root without finding anything that exists.
      if (parent === existing) break;
      existing = parent;
      continue;
    }

    const realRoot = realpathSync(rootResolved);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      throw new UserFacingError(`Path escapes the workspace: ${relative}`);
    }
    break;
  }

  return target;
}

/** True when `relative` is a path safeJoin would accept, without throwing. */
export function isSafeRelative(root: string, relative: string): boolean {
  try {
    safeJoin(root, relative);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds an absolute path for an internal, app-generated file or directory.
 *
 * Both parts are constrained: the id must be a UUID we generated and the suffix
 * comes from a fixed set of internal constants, so no caller can walk out of the
 * data directory even if an identifier reaches here straight from a request.
 */
export function internalPath(base: string, id: string, suffix = ''): string {
  if (!isValidId(id)) {
    throw new UserFacingError('Refusing to build a storage path for an invalid id.');
  }
  if (!/^[.a-z0-9]*$/.test(suffix)) {
    throw new Error(`Refusing to build a storage path for suffix "${suffix}"`);
  }
  return join(base, `${id}${suffix}`);
}
