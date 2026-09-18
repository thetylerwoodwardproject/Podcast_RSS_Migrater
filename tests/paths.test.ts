import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { internalPath, isSafeRelative, safeJoin } from '../src/lib/server/paths.js';

let root: string;
let outside: string;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'migrater-paths-'));
  root = join(base, 'workspace');
  outside = join(base, 'outside');
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'secret.txt'), 'private');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('safeJoin', () => {
  it('accepts an ordinary relative path', () => {
    expect(safeJoin(root, 'audio/ep041.mp3')).toBe(join(root, 'audio', 'ep041.mp3'));
  });

  it('accepts a nested path', () => {
    expect(safeJoin(root, 'chapters/images/a.jpg')).toBe(join(root, 'chapters', 'images', 'a.jpg'));
  });

  it('rejects an absolute POSIX path', () => {
    expect(() => safeJoin(root, '/etc/passwd')).toThrow(/Unsafe/);
  });

  it('rejects a Windows drive path', () => {
    // Python's Path.is_absolute() returns false for this on POSIX, so the
    // original check would have let it through.
    expect(() => safeJoin(root, 'C:\\Windows\\system32')).toThrow(/Unsafe/);
  });

  it('rejects a parent-directory segment', () => {
    expect(() => safeJoin(root, '../outside/secret.txt')).toThrow(/Unsafe/);
  });

  it('rejects a parent-directory segment buried mid-path', () => {
    expect(() => safeJoin(root, 'audio/../../outside/secret.txt')).toThrow(/Unsafe/);
  });

  it('rejects a backslash-separated parent segment', () => {
    expect(() => safeJoin(root, 'audio\\..\\..\\outside')).toThrow(/Unsafe/);
  });

  it('rejects an embedded NUL byte', () => {
    // A NUL truncates the path at the syscall boundary, so without this check the
    // segment scan above could pass while the kernel saw something shorter.
    expect(() => safeJoin(root, 'audio/a\u0000/../../etc')).toThrow(/Unsafe/);
  });

  it('rejects an empty path', () => {
    expect(() => safeJoin(root, '')).toThrow(/Unsafe/);
  });

  it('rejects a bare "." segment', () => {
    expect(() => safeJoin(root, './a.mp3')).toThrow(/Unsafe/);
  });

  it('rejects a path escaping through a symlinked directory', async () => {
    // Nothing in the path text looks suspicious; only resolving the link reveals
    // that the write would land outside the workspace.
    await symlink(outside, join(root, 'escape-hatch'), 'dir');
    expect(() => safeJoin(root, 'escape-hatch/secret.txt')).toThrow(/escapes/);
  });

  it('allows a symlink that stays inside the workspace', async () => {
    await mkdir(join(root, 'real'), { recursive: true });
    await symlink(join(root, 'real'), join(root, 'inside-link'), 'dir');
    expect(() => safeJoin(root, 'inside-link/a.mp3')).not.toThrow();
  });
});

describe('isSafeRelative', () => {
  it('reports without throwing', () => {
    expect(isSafeRelative(root, 'audio/a.mp3')).toBe(true);
    expect(isSafeRelative(root, '../x')).toBe(false);
  });
});

describe('internalPath', () => {
  const uuid = '0f9a1d4c-3b7e-4a21-9c8d-2e5f6a7b8c9d';

  it('builds a path from a UUID we generated', () => {
    expect(internalPath('/data/jobs', uuid)).toBe(`/data/jobs/${uuid}`);
  });

  it('refuses anything that is not a UUID', () => {
    // Job ids arrive straight from the request URL, so this is the only thing
    // standing between a path parameter and an arbitrary directory.
    for (const id of ['../../etc', 'not-a-uuid', '', '..', `${uuid}/../..`]) {
      expect(() => internalPath('/data/jobs', id)).toThrow();
    }
  });

  it('refuses a suffix outside the internal allow-list', () => {
    expect(() => internalPath('/data/jobs', uuid, '/../evil')).toThrow();
  });
});
