import type { LogLevel } from './config.js';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function initialThreshold(): number {
  // Read directly rather than through config(), so logging behaves correctly in
  // code paths that never load the full configuration, such as tests.
  const configured = process.env.MIGRATER_LOG_LEVEL?.trim().toLowerCase();
  return configured && configured in LEVEL_ORDER
    ? LEVEL_ORDER[configured as LogLevel]
    : LEVEL_ORDER.info;
}

let threshold = initialThreshold();

export function setLogLevel(level: LogLevel): void {
  threshold = LEVEL_ORDER[level];
}

export type LogFields = Record<string, string | number | boolean | null | undefined>;

function renderValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const text = String(value);
  return /[\s"]/.test(text) ? JSON.stringify(text) : text;
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < threshold) return;

  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), message];
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      parts.push(`${key}=${renderValue(value)}`);
    }
  }

  const line = parts.join(' ');
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
