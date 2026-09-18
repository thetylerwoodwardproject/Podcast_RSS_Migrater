import { ACTIVE_PHASES, type AssetRecord, type LogLine, type MigrationJob, type ServerEvent } from '../../types.js';
import {
  connectEvents,
  createJob as createJobRequest,
  deleteJob as deleteJobRequest,
  fetchAssets,
  fetchHealth,
  fetchJobs,
  fetchSettings,
  publishJob as publishJobRequest,
  startJob as startJobRequest,
} from '../api.js';
import type { CreateJobRequest, HealthResponse, SftpDefaults, SftpRequest } from '../../types.js';

const LOG_LIMIT = 300;

class MigraterState {
  jobs = $state<MigrationJob[]>([]);
  health = $state<HealthResponse | null>(null);
  sftpDefaults = $state<SftpDefaults>({ host: '', port: 22, username: '', remotePath: '/' });
  defaultBaseUrl = $state('');
  defaultQuality = $state(90);

  connected = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);

  expandedJobId = $state<string | null>(null);
  assets = $state<Record<string, AssetRecord[]>>({});
  assetTotals = $state<Record<string, number>>({});
  logs = $state<Record<string, LogLine[]>>({});

  activeJob = $derived(this.jobs.find((job) => ACTIVE_PHASES.has(job.phase)) ?? null);
  plannedJobs = $derived(this.jobs.filter((job) => job.phase === 'planned'));
  working = $derived(this.activeJob !== null);

  private disconnect: (() => void) | null = null;

  async start(): Promise<void> {
    try {
      const [jobs, settings, health] = await Promise.all([fetchJobs(), fetchSettings(), fetchHealth()]);
      this.jobs = jobs.jobs;
      this.sftpDefaults = settings.sftp;
      this.defaultBaseUrl = settings.defaultBaseUrl;
      this.defaultQuality = settings.quality;
      this.health = health;
    } catch {
      // Not fatal: the event stream sends a full snapshot the moment it connects.
    }

    this.disconnect = connectEvents(
      (event) => this.apply(event),
      (connected) => {
        this.connected = connected;
      },
    );
  }

  stop(): void {
    this.disconnect?.();
    this.disconnect = null;
  }

  private apply(event: ServerEvent): void {
    switch (event.type) {
      case 'snapshot':
        this.jobs = event.jobs;
        break;

      case 'job:update': {
        const index = this.jobs.findIndex((job) => job.id === event.job.id);
        if (index === -1) this.jobs = [...this.jobs, event.job];
        else this.jobs[index] = event.job;
        break;
      }

      case 'job:remove':
        this.jobs = this.jobs.filter((job) => job.id !== event.jobId);
        delete this.assets[event.jobId];
        delete this.logs[event.jobId];
        break;

      case 'asset:update': {
        // Only merge for a job the user has open. Otherwise thousands of asset
        // records would accumulate for panels nobody is looking at.
        const current = this.assets[event.jobId];
        if (!current) break;

        const merged = [...current];
        for (const asset of event.assets) {
          const index = merged.findIndex((entry) => entry.id === asset.id);
          if (index === -1) merged.push(asset);
          else merged[index] = asset;
        }
        this.assets[event.jobId] = merged;
        break;
      }

      case 'job:log': {
        const lines = [...(this.logs[event.jobId] ?? []), event.line];
        this.logs[event.jobId] = lines.slice(-LOG_LIMIT);
        break;
      }
    }
  }

  async toggleExpanded(jobId: string): Promise<void> {
    if (this.expandedJobId === jobId) {
      this.expandedJobId = null;
      return;
    }
    this.expandedJobId = jobId;
    await this.loadAssets(jobId);
  }

  async loadAssets(jobId: string): Promise<void> {
    try {
      const page = await fetchAssets(jobId, { limit: 500 });
      this.assets[jobId] = page.assets;
      this.assetTotals[jobId] = page.total;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The asset list could not be loaded.';
    }
  }

  async create(request: CreateJobRequest): Promise<boolean> {
    this.busy = true;
    this.error = null;
    try {
      const { job } = await createJobRequest(request);
      this.expandedJobId = job.id;
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'That feed could not be read.';
      return false;
    } finally {
      this.busy = false;
    }
  }

  async begin(jobId: string): Promise<void> {
    this.busy = true;
    this.error = null;
    try {
      await startJobRequest(jobId);
      await this.loadAssets(jobId);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The archive could not be started.';
    } finally {
      this.busy = false;
    }
  }

  async publish(jobId: string, credentials: SftpRequest): Promise<boolean> {
    this.busy = true;
    this.error = null;
    try {
      const result = await publishJobRequest(jobId, credentials);
      if (!result.ok) {
        this.error = result.error ?? 'The publish failed.';
        return false;
      }
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The publish failed.';
      return false;
    } finally {
      this.busy = false;
    }
  }

  async remove(jobId: string): Promise<void> {
    this.error = null;
    try {
      await deleteJobRequest(jobId);
      if (this.expandedJobId === jobId) this.expandedJobId = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The job could not be deleted.';
    }
  }

  async refreshHealth(): Promise<void> {
    try {
      this.health = await fetchHealth();
    } catch {
      // The header simply shows nothing rather than an error for this.
    }
  }
}

export const migrater = new MigraterState();
