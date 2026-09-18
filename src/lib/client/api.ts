import type {
  AssetRecord,
  CreateJobRequest,
  HealthResponse,
  LogLine,
  MigrationJob,
  ServerEvent,
  SftpDefaults,
  SftpRequest,
} from '../types.js';

const GENERIC_ERROR = 'The server could not be reached.';

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? GENERIC_ERROR;
  } catch {
    return GENERIC_ERROR;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error(GENERIC_ERROR);
  }

  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

function postJson<T>(input: string, body: unknown): Promise<T> {
  return request<T>(input, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}

export function fetchSettings(): Promise<{
  sftp: SftpDefaults;
  defaultBaseUrl: string;
  quality: number;
}> {
  return request('/api/settings');
}

export function fetchJobs(): Promise<{ jobs: MigrationJob[] }> {
  return request('/api/jobs');
}

export function fetchJob(id: string): Promise<{ job: MigrationJob; warnings: string[]; log: LogLine[] }> {
  return request(`/api/jobs/${id}`);
}

export function fetchAssets(
  id: string,
  options: { offset?: number; limit?: number; status?: string; kind?: string } = {},
): Promise<{ assets: AssetRecord[]; total: number; offset: number; limit: number }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return request(`/api/jobs/${id}/assets${suffix === '' ? '' : `?${suffix}`}`);
}

export function createJob(body: CreateJobRequest): Promise<{ job: MigrationJob }> {
  return postJson('/api/jobs', body);
}

export function startJob(id: string): Promise<{ job: MigrationJob }> {
  return postJson(`/api/jobs/${id}/start`, {});
}

export function publishJob(
  id: string,
  credentials: SftpRequest,
): Promise<{ ok: boolean; uploaded?: number; skipped?: number; total?: number; error?: string }> {
  return postJson(`/api/jobs/${id}/publish`, credentials);
}

export function deleteJob(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/jobs/${id}`, { method: 'DELETE' });
}

export function downloadUrl(id: string): string {
  return `/api/jobs/${id}/download`;
}

export function feedUrl(id: string): string {
  return `/api/jobs/${id}/feed`;
}

/**
 * Subscribes to the server's event stream.
 *
 * EventSource reconnects on its own, and every reconnect is answered with a full
 * snapshot, so a dropped connection needs no special handling beyond telling the
 * UI that it is currently offline.
 */
export function connectEvents(
  onEvent: (event: ServerEvent) => void,
  onConnectionChange: (connected: boolean) => void,
): () => void {
  const source = new EventSource('/api/events');

  source.onopen = () => onConnectionChange(true);
  source.onerror = () => onConnectionChange(false);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as ServerEvent);
    } catch {
      // A malformed frame is not worth tearing the stream down for.
    }
  };

  return () => {
    source.close();
    onConnectionChange(false);
  };
}
