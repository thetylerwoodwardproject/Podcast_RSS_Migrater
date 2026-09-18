import { randomUUID } from 'node:crypto';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Unpredictable internal identifier. Also an on-disk directory name, so it must stay opaque. */
export function newId(): string {
  return randomUUID();
}

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
