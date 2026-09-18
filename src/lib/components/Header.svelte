<script lang="ts">
  import { APP_NAME, APP_TAGLINE } from '$lib/constants';
  import { formatBytes } from '$lib/client/format';
  import ConnectionDot from './ConnectionDot.svelte';

  let {
    version = null,
    diskFreeBytes = null,
    connected = false,
  }: { version?: string | null; diskFreeBytes?: number | null; connected?: boolean } = $props();
</script>

<header>
  <div class="lockup">
    <svg viewBox="0 0 640 512" aria-hidden="true">
      <path
        fill="currentColor"
        d="M32 32C14.3 32 0 46.3 0 64v64c0 17.7 14.3 32 32 32H608c17.7 0 32-14.3 32-32V64c0-17.7-14.3-32-32-32H32zM32 192V400c0 44.2 35.8 80 80 80H528c44.2 0 80-35.8 80-80V192H32zm240 64H368c8.8 0 16 7.2 16 16s-7.2 16-16 16H272c-8.8 0-16-7.2-16-16s7.2-16 16-16z"
      />
    </svg>
    <div>
      <h1>{APP_NAME}</h1>
      <p class="muted">{APP_TAGLINE}</p>
    </div>
  </div>

  <div class="meta mono">
    <ConnectionDot {connected} />
    {#if diskFreeBytes !== null}
      <span title="Free space for job workspaces">{formatBytes(diskFreeBytes)} free</span>
    {/if}
    {#if version}
      <span>v{version}</span>
    {/if}
  </div>
</header>

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap);
    margin-bottom: var(--gap);
  }

  .lockup {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  svg {
    width: 2em;
    height: 2em;
    color: var(--accent);
    flex-shrink: 0;
  }

  h1 {
    margin: 0;
    font-size: 1.4rem;
  }

  p {
    margin: 2px 0 0;
    font-size: 0.9rem;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 0.82rem;
    color: var(--text-muted);
  }
</style>
