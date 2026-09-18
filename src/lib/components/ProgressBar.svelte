<script lang="ts">
  let {
    done = 0,
    total = 0,
    label = null,
  }: { done?: number; total?: number; label?: string | null } = $props();

  const percent = $derived(total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);
  const indeterminate = $derived(total <= 0);
</script>

<div
  class="track"
  role="progressbar"
  aria-valuemin="0"
  aria-valuemax={total > 0 ? total : undefined}
  aria-valuenow={total > 0 ? done : undefined}
  aria-label={label ?? 'Progress'}
>
  <div class="fill" class:indeterminate style={indeterminate ? '' : `width: ${percent}%`}></div>
</div>

<style>
  .track {
    height: 6px;
    background: var(--panel-raised);
    border-radius: 999px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 200ms ease;
  }

  /* Used while a phase reports no total, e.g. a ZIP stream whose size is unknown. */
  .fill.indeterminate {
    width: 35%;
    animation: slide 1.4s ease-in-out infinite;
  }

  @keyframes slide {
    0% { margin-left: -35%; }
    100% { margin-left: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .fill { transition: none; }
    .fill.indeterminate { animation: none; width: 100%; margin-left: 0; opacity: 0.4; }
  }
</style>
