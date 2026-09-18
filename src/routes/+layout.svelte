<script lang="ts">
  import '../app.css';
  import { APP_NAME, APP_TAGLINE } from '$lib/constants';

  let { children }: { children: import('svelte').Snippet } = $props();
</script>

<svelte:head>
  <title>{APP_NAME}</title>
  <meta name="color-scheme" content="dark" />
  <meta name="description" content={APP_TAGLINE} />
</svelte:head>

{@render children()}
