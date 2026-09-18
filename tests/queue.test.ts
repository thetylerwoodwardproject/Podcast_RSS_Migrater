import { afterEach, describe, expect, it } from 'vitest';

import type { MigrationJob, ServerEvent } from '../src/lib/types.js';
import {
  addJob,
  deleteJob,
  getJob,
  listJobs,
  resetQueueForTests,
  snapshot,
  subscribe,
  subscriberCount,
  toPublicJob,
  updateJob,
  type InternalJob,
} from '../src/lib/server/jobs/queue.js';

function job(id: string, createdAt = Date.now()): InternalJob {
  const base: MigrationJob = {
    id,
    feedUrl: 'https://old.example.com/feed.xml',
    baseUrl: 'https://cdn.example.com/',
    quality: 90,
    rehostFeed: true,
    phase: 'planned',
    progress: { done: 0, total: 0, bytesDone: null, bytesTotal: null, current: null },
    showTitle: 'Show',
    episodeCount: 0,
    counts: { assets: 0, downloaded: 0, converted: 0, skipped: 0, failed: 0 },
    bytesOnDisk: 0,
    validation: null,
    delivery: { zipReady: false, sftpStatus: 'idle', sftpUploaded: 0, sftpTotal: 0, sftpError: null },
    warnings: [],
    error: null,
    createdAt,
    updatedAt: createdAt,
  };

  return {
    ...base,
    workspacePath: '/var/lib/migrater/jobs/secret',
    assets: new Map(),
    urlMap: new Map([['a', 'b']]),
    feedBefore: '<rss/>',
    feedAfter: '<rss/>',
    log: [],
    sftp: {
      host: 'sftp.example.com',
      port: 22,
      username: 'deploy',
      authType: 'password',
      password: 'hunter2',
      remotePath: '/',
    },
    abort: new AbortController(),
  };
}

afterEach(() => {
  resetQueueForTests();
});

describe('toPublicJob', () => {
  it('strips every field that must not reach the browser', () => {
    // Through `unknown`: the point of the test is to look for keys the type says
    // are not there, which a direct assertion rightly refuses.
    const publicJob = toPublicJob(job('a')) as unknown as Record<string, unknown>;

    for (const field of ['workspacePath', 'assets', 'urlMap', 'feedBefore', 'feedAfter', 'log', 'sftp', 'abort']) {
      expect(publicJob[field]).toBeUndefined();
    }
    // Nothing resembling a credential survives serialization.
    expect(JSON.stringify(publicJob)).not.toContain('hunter2');
    expect(JSON.stringify(publicJob)).not.toContain('/var/lib/migrater');
  });

  it('keeps the fields the UI needs', () => {
    const publicJob = toPublicJob(job('a'));
    expect(publicJob.id).toBe('a');
    expect(publicJob.showTitle).toBe('Show');
    expect(publicJob.baseUrl).toBe('https://cdn.example.com/');
  });
});

describe('the queue', () => {
  it('orders jobs by creation time', () => {
    addJob(job('second', 2000));
    addJob(job('first', 1000));
    expect(listJobs().map((entry) => entry.id)).toEqual(['first', 'second']);
  });

  it('emits on add, update and remove', () => {
    const events: ServerEvent[] = [];
    subscribe((event) => events.push(event));

    addJob(job('a'));
    updateJob('a', { phase: 'downloading' });
    deleteJob('a');

    expect(events.map((event) => event.type)).toEqual(['job:update', 'job:update', 'job:remove']);
  });

  it('never emits internal fields', () => {
    const events: ServerEvent[] = [];
    subscribe((event) => events.push(event));
    addJob(job('a'));

    expect(JSON.stringify(events)).not.toContain('hunter2');
    expect(JSON.stringify(events)).not.toContain('/var/lib/migrater');
  });

  it('unsubscribes cleanly, so a disconnected stream leaks nothing', () => {
    const unsubscribe = subscribe(() => {});
    expect(subscriberCount()).toBe(1);
    unsubscribe();
    expect(subscriberCount()).toBe(0);
  });

  it('keeps one dead listener from stopping the others', () => {
    const delivered: string[] = [];
    subscribe(() => {
      throw new Error('this stream is gone');
    });
    subscribe((event) => delivered.push(event.type));

    addJob(job('a'));
    expect(delivered).toEqual(['job:update']);
  });

  it('mutates in place so held references stay valid', () => {
    addJob(job('a'));
    const held = getJob('a')!;
    updateJob('a', { phase: 'ready' });
    expect(held.phase).toBe('ready');
  });

  it('returns a public snapshot', () => {
    addJob(job('a'));
    expect(JSON.stringify(snapshot())).not.toContain('hunter2');
  });
});
