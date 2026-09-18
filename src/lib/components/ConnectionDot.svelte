<script lang="ts">
  let { connected = false }: { connected?: boolean } = $props();
</script>

<span class="wrap" title={connected ? 'Receiving live updates' : 'Reconnecting to the server'}>
  <span class="dot" class:connected></span>
  {connected ? 'live' : 'reconnecting'}
</span>

<style>
  .wrap {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--warning);
  }

  .dot.connected {
    background: var(--accent);
  }
</style>
