import type { ServerEvent } from '../../types.js';
import { snapshot, subscribe } from './queue.js';

const KEEP_ALIVE_MS = 20_000;

/**
 * Open streams, so shutdown can end them.
 *
 * This is not optional tidiness. adapter-node waits for in-flight requests before
 * it closes, and an SSE connection is an in-flight request that by design never
 * ends, so without this `systemctl stop` would block until the shutdown timeout
 * every single time.
 */
const openStreams = new Set<() => void>();

/**
 * Streams job changes to every connected browser.
 *
 * There is one stream for the whole server rather than one per job, because the
 * queue is shared: every browser pointed at this server sees the same jobs. A
 * full snapshot goes out immediately on connect, so a client that arrives late,
 * or reconnects after a dropout, is never out of step.
 */
export function openEventStream(request: Request): Response {
  const encoder = new TextEncoder();
  let close: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const write = (payload: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // The client went away between the check and the enqueue.
          close();
        }
      };

      const send = (event: ServerEvent): void => write(`data: ${JSON.stringify(event)}\n\n`);

      send({ type: 'snapshot', jobs: snapshot() });

      const unsubscribe = subscribe(send);
      const keepAlive = setInterval(() => write(': keep-alive\n\n'), KEEP_ALIVE_MS);

      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        openStreams.delete(close);
        try {
          controller.close();
        } catch {
          // Already closed or errored.
        }
      };

      openStreams.add(close);
      request.signal.addEventListener('abort', close);
    },

    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Stops nginx buffering the stream when this sits behind a reverse proxy.
      'x-accel-buffering': 'no',
    },
  });
}

/** Ends every open stream, so the process can shut down promptly. */
export function closeAllEventStreams(): void {
  for (const close of [...openStreams]) close();
  openStreams.clear();
}

export function openStreamCount(): number {
  return openStreams.size;
}
