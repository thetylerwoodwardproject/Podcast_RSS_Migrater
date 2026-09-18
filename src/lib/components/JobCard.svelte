<script lang="ts">
  import { PHASE_LABELS } from '$lib/constants';
  import type { AssetRecord, LogLine, MigrationJob, SftpDefaults, SftpRequest } from '$lib/types';
  import { ACTIVE_PHASES } from '$lib/types';
  import { formatBytes, formatCount, formatRelative, formatTime } from '$lib/client/format';
  import AssetTable from './AssetTable.svelte';
  import DeliverPanel from './DeliverPanel.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import ValidationPanel from './ValidationPanel.svelte';

  let {
    job,
    assets = [],
    assetTotal = 0,
    log = [],
    expanded = false,
    busy = false,
    sftpDefaults,
    ontoggle,
    onstart,
    ondelete,
    onpublish,
  }: {
    job: MigrationJob;
    assets?: AssetRecord[];
    assetTotal?: number;
    log?: LogLine[];
    expanded?: boolean;
    busy?: boolean;
    sftpDefaults: SftpDefaults;
    ontoggle: () => void;
    onstart: () => void;
    ondelete: () => void;
    onpublish: (credentials: SftpRequest) => Promise<boolean>;
  } = $props();

  const active = $derived(ACTIVE_PHASES.has(job.phase));
  const deliverable = $derived(job.phase === 'ready' || job.phase === 'complete');
  const heading = $derived(job.showTitle ?? job.feedUrl);
</script>

<article class="panel" data-phase={job.phase}>
  <div class="head">
    <div class="title">
      <h3>{heading}</h3>
      <p class="muted mono">{job.feedUrl}</p>
    </div>
    <span class="phase" data-phase={job.phase}>{PHASE_LABELS[job.phase]}</span>
  </div>

  <dl class="stats">
    <div><dt>Episodes</dt><dd>{job.episodeCount.toLocaleString()}</dd></div>
    <div><dt>Assets</dt><dd>{job.counts.assets.toLocaleString()}</dd></div>
    <div><dt>Archived</dt><dd>{job.counts.downloaded.toLocaleString()}</dd></div>
    {#if job.counts.failed > 0}
      <div><dt>Failed</dt><dd class="bad">{job.counts.failed.toLocaleString()}</dd></div>
    {/if}
    <div><dt>On disk</dt><dd>{formatBytes(job.bytesOnDisk)}</dd></div>
    <div><dt>Started</dt><dd>{formatRelative(job.createdAt)}</dd></div>
  </dl>

  {#if active}
    <div class="progress">
      <ProgressBar
        done={job.progress.done}
        total={job.progress.total}
        label={PHASE_LABELS[job.phase]}
      />
      <p class="muted">
        {PHASE_LABELS[job.phase]}
        {#if job.progress.total > 0}
          — {job.progress.done} of {job.progress.total}
        {/if}
        {#if job.progress.bytesDone !== null}
          ({formatBytes(job.progress.bytesDone)})
        {/if}
        {#if job.progress.current}
          <span class="mono">{job.progress.current}</span>
        {/if}
      </p>
    </div>
  {/if}

  {#if job.error}
    <p class="banner error">{job.error}</p>
  {/if}

  {#if job.phase === 'planned'}
    <p class="banner">
      Ready to archive {formatCount(job.counts.assets, 'asset')} from
      {formatCount(job.episodeCount, 'episode')}. Nothing has been downloaded yet.
    </p>
  {/if}

  {#if job.warnings.length > 0}
    <details>
      <summary class="warn">{formatCount(job.warnings.length, 'warning')}</summary>
      <ul class="warnings">
        {#each job.warnings as warning (warning)}
          <li>{warning}</li>
        {/each}
      </ul>
    </details>
  {/if}

  {#if job.validation}
    <ValidationPanel report={job.validation} />
  {/if}

  {#if deliverable}
    <DeliverPanel {job} defaults={sftpDefaults} {busy} {onpublish} />
  {/if}

  <div class="row actions">
    {#if job.phase === 'planned'}
      <button type="button" class="primary" onclick={onstart} disabled={busy}>Start archive</button>
    {/if}
    <button type="button" class="quiet" onclick={ontoggle}>
      {expanded ? 'Hide details' : 'Show details'}
    </button>
    <button type="button" class="danger" onclick={ondelete} disabled={busy}>Delete</button>
  </div>

  {#if expanded}
    <div class="details">
      <h4>Assets</h4>
      <AssetTable {assets} total={assetTotal} />

      {#if log.length > 0}
        <h4>Log</h4>
        <ul class="log mono">
          {#each log as line (line.at + line.message)}
            <li data-level={line.level}>
              <span class="muted">{formatTime(line.at)}</span>
              {line.message}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</article>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
  }

  .title h3 {
    margin: 0;
    font-size: 1.05rem;
  }

  .title p {
    margin: 2px 0 0;
    font-size: 0.82rem;
    word-break: break-all;
  }

  .phase {
    flex-shrink: 0;
    font-size: 0.78rem;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .phase[data-phase='ready'],
  .phase[data-phase='complete'] {
    color: var(--accent);
    border-color: var(--accent-muted);
  }

  .phase[data-phase='failed'] {
    color: var(--danger);
    border-color: var(--danger);
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin: 16px 0 0;
  }

  .stats div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  dd.bad {
    color: var(--danger);
  }

  .progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 16px;
  }

  .progress p {
    margin: 0;
    font-size: 0.85rem;
  }

  .warn {
    color: var(--warning);
    cursor: pointer;
  }

  .warnings {
    margin: 10px 0 0;
    padding-left: 20px;
    font-size: 0.88rem;
    color: var(--text-muted);
  }

  .actions {
    margin-top: 16px;
  }

  .details {
    margin-top: 18px;
    border-top: 1px solid var(--border);
    padding-top: 16px;
  }

  h4 {
    margin: 0 0 10px;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .details h4:not(:first-child) {
    margin-top: 20px;
  }

  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 260px;
    overflow-y: auto;
    font-size: 0.82rem;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .log li[data-level='warn'] {
    color: var(--warning);
  }

  .log li[data-level='error'] {
    color: var(--danger);
  }
</style>
