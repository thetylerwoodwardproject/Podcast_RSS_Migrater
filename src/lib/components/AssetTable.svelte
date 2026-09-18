<script lang="ts">
  import type { AssetRecord } from '$lib/types';
  import { formatBytes, truncateUrl } from '$lib/client/format';

  let {
    assets = [],
    total = 0,
  }: { assets?: AssetRecord[]; total?: number } = $props();

  // Thousands of table rows will make the page janky, so only a window is rendered
  // until the user asks for the rest.
  const PAGE = 200;
  let shown = $state(PAGE);

  const visible = $derived(assets.slice(0, shown));
  const remaining = $derived(Math.max(0, assets.length - shown));
</script>

{#if assets.length === 0}
  <p class="muted">No assets yet.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Kind</th>
        <th>Source</th>
        <th>Local path</th>
        <th class="right">Size</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {#each visible as asset (asset.id)}
        <tr>
          <td class="muted">{asset.kind}</td>
          <td class="mono" title={asset.sourceUrl}>{truncateUrl(asset.sourceUrl, 48)}</td>
          <td class="mono">{asset.relativePath}</td>
          <td class="right mono">{formatBytes(asset.bytes ?? asset.expectedBytes)}</td>
          <td>
            <span class="status" data-status={asset.status}>{asset.status}</span>
            {#if asset.error}
              <span class="error" title={asset.error}>— {asset.error}</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if remaining > 0}
    <button type="button" class="quiet" onclick={() => (shown += PAGE)}>
      Show {Math.min(PAGE, remaining)} more ({remaining} hidden)
    </button>
  {/if}

  {#if total > assets.length}
    <p class="muted">Showing {assets.length} of {total} assets.</p>
  {/if}
{/if}

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
  }

  th,
  td {
    text-align: left;
    padding: 6px 10px 6px 0;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  th {
    color: var(--text-muted);
    font-weight: 600;
    white-space: nowrap;
  }

  .right {
    text-align: right;
    white-space: nowrap;
  }

  td.mono {
    word-break: break-all;
  }

  .status {
    text-transform: capitalize;
  }

  .status[data-status='failed'] {
    color: var(--danger);
  }

  .status[data-status='converted'],
  .status[data-status='downloaded'] {
    color: var(--accent);
  }

  .status[data-status='skipped'] {
    color: var(--warning);
  }

  .error {
    color: var(--danger);
    font-size: 0.85em;
  }
</style>
