<script lang="ts">
  import type { MigrationJob, SftpDefaults, SftpRequest } from '$lib/types';
  import { downloadUrl, feedUrl } from '$lib/client/api';
  import { formatBytes } from '$lib/client/format';
  import ProgressBar from './ProgressBar.svelte';

  let {
    job,
    defaults,
    busy = false,
    onpublish,
  }: {
    job: MigrationJob;
    defaults: SftpDefaults;
    busy?: boolean;
    onpublish: (credentials: SftpRequest) => Promise<boolean>;
  } = $props();

  let host = $state('');
  let port = $state(22);
  let username = $state('');
  let authType = $state<'password' | 'key'>('password');
  let password = $state('');
  let privateKey = $state('');
  let passphrase = $state('');
  let remotePath = $state('/');
  let showSftp = $state(false);

  // Seed from the server's non-secret defaults once they arrive, without
  // clobbering anything already typed.
  $effect(() => {
    if (host === '' && defaults.host !== '') host = defaults.host;
    if (username === '' && defaults.username !== '') username = defaults.username;
    if (remotePath === '/' && defaults.remotePath !== '') remotePath = defaults.remotePath;
    if (port === 22 && defaults.port !== 22) port = defaults.port;
  });

  const large = $derived(job.bytesOnDisk > 2 * 1000 * 1000 * 1000);
  const publishing = $derived(job.delivery.sftpStatus === 'running');
  const ready = $derived(
    host.trim() !== '' &&
      username.trim() !== '' &&
      (authType === 'password' ? password !== '' : privateKey !== ''),
  );

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!ready || busy || publishing) return;

    const sent = await onpublish({
      host: host.trim(),
      port,
      username: username.trim(),
      authType,
      password: authType === 'password' ? password : undefined,
      privateKey: authType === 'key' ? privateKey : undefined,
      passphrase: authType === 'key' && passphrase !== '' ? passphrase : undefined,
      remotePath: remotePath.trim() || '/',
    });

    // Clear the secrets from the form either way; they are not stored anywhere.
    if (sent) {
      password = '';
      privateKey = '';
      passphrase = '';
    }
  }
</script>

<div class="deliver">
  <div class="row">
    <a class="button primary" href={downloadUrl(job.id)} download>Download ZIP</a>
    <a class="button quiet" href={feedUrl(job.id)} target="_blank" rel="noreferrer">
      View rewritten feed
    </a>
    <span class="muted">{formatBytes(job.bytesOnDisk)} on disk</span>
  </div>

  {#if large}
    <p class="banner warning">
      This archive is {formatBytes(job.bytesOnDisk)}. The ZIP is streamed as it is built, so the
      browser cannot show progress and the download cannot be resumed if it drops. SFTP is the
      better route at this size.
    </p>
  {/if}

  <details bind:open={showSftp}>
    <summary>Publish over SFTP</summary>

    <form onsubmit={submit}>
      <p class="muted hint">
        Uploads the whole archive, preserving relative paths, so the URLs the rewritten feed now
        points at resolve. Credentials are used for this transfer only and are never written to disk.
      </p>

      <div class="grid">
        <div class="field">
          <label for="sftp-host">Host</label>
          <input id="sftp-host" type="text" bind:value={host} autocomplete="off" spellcheck="false" />
        </div>
        <div class="field port">
          <label for="sftp-port">Port</label>
          <input id="sftp-port" type="number" min="1" max="65535" bind:value={port} />
        </div>
      </div>

      <div class="field">
        <label for="sftp-user">Username</label>
        <input id="sftp-user" type="text" bind:value={username} autocomplete="off" spellcheck="false" />
      </div>

      <div class="field">
        <label for="sftp-auth">Authentication</label>
        <select id="sftp-auth" bind:value={authType}>
          <option value="password">Password</option>
          <option value="key">Private key</option>
        </select>
      </div>

      {#if authType === 'password'}
        <div class="field">
          <label for="sftp-password">Password</label>
          <input id="sftp-password" type="password" bind:value={password} autocomplete="off" />
        </div>
      {:else}
        <div class="field">
          <label for="sftp-key">Private key (PEM)</label>
          <textarea id="sftp-key" rows="4" bind:value={privateKey} spellcheck="false"></textarea>
        </div>
        <div class="field">
          <label for="sftp-passphrase">Key passphrase (optional)</label>
          <input id="sftp-passphrase" type="password" bind:value={passphrase} autocomplete="off" />
        </div>
      {/if}

      <div class="field">
        <label for="sftp-path">Remote path</label>
        <input id="sftp-path" type="text" bind:value={remotePath} autocomplete="off" spellcheck="false" />
      </div>

      {#if publishing}
        <div class="progress">
          <ProgressBar
            done={job.delivery.sftpUploaded}
            total={job.delivery.sftpTotal}
            label="SFTP upload progress"
          />
          <p class="muted">
            Uploaded {job.delivery.sftpUploaded} of {job.delivery.sftpTotal} files.
          </p>
        </div>
      {/if}

      {#if job.delivery.sftpError}
        <p class="banner error">{job.delivery.sftpError}</p>
      {:else if job.delivery.sftpStatus === 'complete'}
        <p class="banner success">
          Published {job.delivery.sftpUploaded} of {job.delivery.sftpTotal} files.
        </p>
      {/if}

      <div class="row">
        <button type="submit" class="primary" disabled={!ready || busy || publishing}>
          {publishing ? 'Publishing…' : 'Publish now'}
        </button>
      </div>
    </form>
  </details>
</div>

<style>
  .deliver {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .button {
    display: inline-block;
    text-decoration: none;
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

  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 14px;
  }

  .hint {
    font-size: 0.85rem;
    margin: 0;
  }

  .grid {
    display: flex;
    gap: 12px;
  }

  .grid .field:first-child {
    flex: 1;
  }

  .port {
    width: 110px;
    flex-shrink: 0;
  }

  .progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .progress p {
    margin: 0;
    font-size: 0.85rem;
  }
</style>
