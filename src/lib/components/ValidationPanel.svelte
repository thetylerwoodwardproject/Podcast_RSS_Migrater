<script lang="ts">
  import type { ValidationReport } from '$lib/types';

  let { report }: { report: ValidationReport } = $props();

  const clean = $derived(report.failed === 0 && report.warned === 0);
</script>

{#if clean}
  <p class="banner success">All {report.passed} checks passed.</p>
{:else}
  <details open={report.failed > 0}>
    <summary>
      {report.passed} passed,
      <span class:warn={report.warned > 0}>{report.warned} warned</span>,
      <span class:fail={report.failed > 0}>{report.failed} failed</span>
    </summary>

    <ul>
      {#each report.checks as check (check.id)}
        <li data-status={check.status}>
          <span class="marker" aria-hidden="true">
            {check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✕'}
          </span>
          <span>
            <span class="label">{check.label}</span>
            {#if check.detail}
              <span class="muted detail">{check.detail}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  summary {
    cursor: pointer;
  }

  ul {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  li {
    display: flex;
    gap: 10px;
    font-size: 0.9rem;
  }

  .marker {
    flex-shrink: 0;
    width: 1em;
    text-align: center;
    color: var(--accent);
  }

  li[data-status='warn'] .marker,
  .warn {
    color: var(--warning);
  }

  li[data-status='fail'] .marker,
  .fail {
    color: var(--danger);
  }

  .detail {
    display: block;
    font-size: 0.88em;
  }
</style>
