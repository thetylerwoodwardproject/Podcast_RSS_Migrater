<script lang="ts">
  import { onMount } from 'svelte';

  import Header from '$lib/components/Header.svelte';
  import JobCard from '$lib/components/JobCard.svelte';
  import NewJobPanel from '$lib/components/NewJobPanel.svelte';
  import { migrater } from '$lib/client/stores/jobs.svelte';
  import type { CreateJobRequest, SftpRequest } from '$lib/types';

  onMount(() => {
    void migrater.start();
    return () => migrater.stop();
  });

  async function create(request: CreateJobRequest): Promise<boolean> {
    return migrater.create(request);
  }

  function publishFor(jobId: string): (credentials: SftpRequest) => Promise<boolean> {
    return (credentials) => migrater.publish(jobId, credentials);
  }
</script>

<main>
  <Header
    version={migrater.health?.version ?? null}
    diskFreeBytes={migrater.health?.diskFreeBytes ?? null}
    connected={migrater.connected}
  />

  {#if migrater.health?.status === 'degraded'}
    <p class="banner warning">
      This server's image library cannot encode JPEG, so artwork will not be converted.
    </p>
  {/if}

  {#if migrater.error}
    <p class="banner error">{migrater.error}</p>
  {/if}

  <NewJobPanel
    defaultBaseUrl={migrater.defaultBaseUrl}
    defaultQuality={migrater.defaultQuality}
    busy={migrater.busy}
    disabled={migrater.working}
    onsubmit={create}
  />

  {#if migrater.jobs.length === 0}
    <p class="muted empty">No jobs yet. Paste a feed URL above to see what it would archive.</p>
  {:else}
    <div class="jobs">
      {#each [...migrater.jobs].reverse() as job (job.id)}
        <JobCard
          {job}
          assets={migrater.assets[job.id] ?? []}
          assetTotal={migrater.assetTotals[job.id] ?? 0}
          log={migrater.logs[job.id] ?? []}
          expanded={migrater.expandedJobId === job.id}
          busy={migrater.busy}
          sftpDefaults={migrater.sftpDefaults}
          ontoggle={() => migrater.toggleExpanded(job.id)}
          onstart={() => migrater.begin(job.id)}
          ondelete={() => migrater.remove(job.id)}
          onpublish={publishFor(job.id)}
        />
      {/each}
    </div>
  {/if}
</main>

<style>
  main {
    max-width: 940px;
    margin: 0 auto;
    padding: 28px 20px 60px;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  .jobs {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  .empty {
    text-align: center;
    padding: 30px 0;
  }
</style>
