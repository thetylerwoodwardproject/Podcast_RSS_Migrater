<script lang="ts">
  import type { CreateJobRequest } from '$lib/types';

  let {
    defaultBaseUrl = '',
    defaultQuality = 90,
    busy = false,
    disabled = false,
    onsubmit,
  }: {
    defaultBaseUrl?: string;
    defaultQuality?: number;
    busy?: boolean;
    disabled?: boolean;
    onsubmit: (request: CreateJobRequest) => Promise<boolean>;
  } = $props();

  let feedUrl = $state('');
  let baseUrl = $state('');
  let quality = $state(90);
  let rehostFeed = $state(true);
  let showAdvanced = $state(false);

  // The defaults arrive from /api/settings after the first render, so the fields
  // are seeded once when they land and never overwrite something already typed.
  let qualitySeeded = false;

  $effect(() => {
    if (baseUrl === '' && defaultBaseUrl !== '') baseUrl = defaultBaseUrl;
  });
  $effect(() => {
    if (!qualitySeeded && defaultQuality > 0) {
      qualitySeeded = true;
      quality = defaultQuality;
    }
  });

  const ready = $derived(feedUrl.trim() !== '' && baseUrl.trim() !== '');

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!ready || busy || disabled) return;

    const accepted = await onsubmit({
      feedUrl: feedUrl.trim(),
      baseUrl: baseUrl.trim(),
      quality,
      rehostFeed,
    });
    if (accepted) feedUrl = '';
  }
</script>

<section class="panel">
  <h2>Archive a podcast</h2>
  <p class="muted">
    Reads the feed and lists everything it would download. Nothing is fetched until you confirm.
  </p>

  <form onsubmit={submit}>
    <div class="field">
      <label for="feed-url">Source feed URL</label>
      <input
        id="feed-url"
        type="url"
        bind:value={feedUrl}
        placeholder="https://example.com/feed.xml"
        autocomplete="off"
        spellcheck="false"
        required
      />
    </div>

    <div class="field">
      <label for="base-url">New hosting base URL</label>
      <input
        id="base-url"
        type="url"
        bind:value={baseUrl}
        placeholder="https://media.example.com/"
        autocomplete="off"
        spellcheck="false"
        required
      />
      <p class="muted hint">
        Every asset URL in the feed is rewritten to sit under this prefix, keeping its relative path.
      </p>
    </div>

    <details bind:open={showAdvanced}>
      <summary>Options</summary>

      <div class="options">
        <div class="field">
          <label for="quality">JPEG quality</label>
          <input id="quality" type="number" min="1" max="100" bind:value={quality} />
          <p class="muted hint">
            Artwork is re-encoded as JPEG at this quality. Dimensions are never changed.
          </p>
        </div>

        <label class="checkbox">
          <input type="checkbox" bind:checked={rehostFeed} />
          <span>
            Rehost the feed itself
            <span class="muted hint">
              Rewrites the feed's own <code>atom:link rel="self"</code>. Turn this off when only the
              media is moving and the feed stays where it is.
            </span>
          </span>
        </label>
      </div>
    </details>

    <div class="row">
      <button type="submit" class="primary" disabled={!ready || busy || disabled}>
        {busy ? 'Reading feed…' : 'Preview'}
      </button>
      {#if disabled}
        <span class="muted">Another job is running.</span>
      {/if}
    </div>
  </form>
</section>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .hint {
    font-size: 0.85rem;
    margin: 4px 0 0;
  }

  details {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }

  summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-top: 14px;
  }

  .checkbox {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
  }

  .checkbox input {
    margin-top: 4px;
    width: auto;
    flex-shrink: 0;
  }

  .checkbox .hint {
    display: block;
  }

  code {
    font-size: 0.85em;
  }
</style>
