# Podcast RSS Archiver

Prepare an existing podcast backup for a new hosting location. This Python script converts artwork to JPEG, rewrites podcast asset URLs, and keeps the backup manifest in sync.

## Requirements

- macOS with Python 3.8 or newer. Image conversion uses macOS's built-in `sips` command; no Python packages are needed.
- A podcast backup folder containing `feed.xml`, `manifest.json`, and the downloaded assets. The manifest must map original URLs to local files, as in this backup.
- Internet access only if the channel cover is missing and must be downloaded.

This script prepares an existing backup. It does not download an entire podcast or upload files to object storage.

## Quick start

From inside this `podcast_rss_archiver` folder, preview changes to the podcast backup in its parent directory:

```bash
python3 migrate_podcast.py .. --dry-run
```

Apply the migration using the default Linode URL and 90% JPEG quality:

```bash
python3 migrate_podcast.py ..
```

Alternatively, run from the podcast backup directory:

```bash
python3 podcast_rss_archiver/migrate_podcast.py . --dry-run
python3 podcast_rss_archiver/migrate_podcast.py .
```

**The backup supplied with this script has already been migrated.** You do not need to run the conversion on it again. Use the dry run to inspect it, or point the script at another backup. The first actual run of this reusable script will recompress existing JPEGs; subsequent runs can skip images it has already processed.

## Commands and options

Show help:

```bash
python3 migrate_podcast.py --help
```

Preview a backup at another location, without modifying files or downloading the cover:

```bash
python3 migrate_podcast.py "/Users/yourname/Downloads/podcast_backup/backup-folder" --dry-run
```

Set a different hosting URL:

```bash
python3 migrate_podcast.py "/path/to/backup" \
  --base-url "https://cdn.example.com/podcast/"
```

Set JPEG quality to 85:

```bash
python3 migrate_podcast.py "/path/to/backup" --quality 85
```

Combine options to preview a migration:

```bash
python3 migrate_podcast.py "/path/to/backup" \
  --base-url "https://cdn.example.com/podcast/" \
  --quality 90 \
  --dry-run
```

Require all artwork to be available locally:

```bash
python3 migrate_podcast.py "/path/to/backup" --no-download-cover
```

Run a script saved elsewhere against the current directory:

```bash
python3 "/path/to/podcast_rss_archiver/migrate_podcast.py"
```

| Argument or option | Default | Purpose |
| --- | --- | --- |
| `folder` | Current working directory | Folder containing `feed.xml` and `manifest.json`. |
| `--base-url URL` | `https://twp.us-ord-10.linodeobjects.com/` | Prefix for hosted asset URLs. A trailing slash is added automatically. |
| `--quality NUMBER` | `90` | JPEG encoder quality from 1 to 100. This is not a percentage reduction in file size. |
| `--dry-run` | Off | Check mappings and report planned changes. Does not write files, download covers, or test image conversion. |
| `--no-download-cover` | Off | Stop if the channel cover is missing from the manifest rather than downloading it. |
| `-h`, `--help` | — | Show usage and exit. |

## What changes

1. Recursively scans the backup for image files, excluding hidden files and directories.
2. Converts images to `.jpg` at the chosen quality, retaining pixel dimensions. Existing JPEGs are also recompressed unless the script previously processed the exact file at that quality.
3. Verifies each JPEG before installing it. Conversion uses `sips`; PNG and JPEG are the expected inputs for this backup. Other recognized formats depend on the macOS version. Use static, single-frame images: JPEG cannot preserve animation, multiple pages, or transparency.
4. Downloads a missing channel cover to `images/podcast-cover.jpg` when needed.
5. Rewrites the feed's self URL, audio enclosures, episode and channel artwork, transcripts, chapter files, and embedded chapter artwork URLs.
6. Updates image references inside chapter JSON files and corrects enclosure byte lengths if needed.
7. Updates manifest file paths, byte sizes, and checksums for changed files. Original download URLs stay in `url` and `resolved_url`; new locations are recorded in `hosted_url` and `hosted_feed_url`.
8. Removes replaced non-JPEG image originals, including PNGs, after the converted files and updated metadata are installed.

Website, funding, voicemail, XML namespace, stylesheet, and hub URLs remain unchanged. Episode GUIDs, descriptions, publication dates, and audio contents are preserved, except that mapped asset URLs inside text are rewritten.

The relative folder structure becomes the URL path:

| Local file | Hosted URL |
| --- | --- |
| `feed.xml` | `https://twp.us-ord-10.linodeobjects.com/feed.xml` |
| `audio/ep041.mp3` | `https://twp.us-ord-10.linodeobjects.com/audio/ep041.mp3` |
| `images/ep041.jpg` | `https://twp.us-ord-10.linodeobjects.com/images/ep041.jpg` |
| `chapters/ep041.json` | `https://twp.us-ord-10.linodeobjects.com/chapters/ep041.json` |
| `chapters/images/ep041-chapter001.jpg` | `https://twp.us-ord-10.linodeobjects.com/chapters/images/ep041-chapter001.jpg` |
| `transcripts/ep041.vtt` | `https://twp.us-ord-10.linodeobjects.com/transcripts/ep041.vtt` |

## Backups and repeated runs

The script stages and validates the outputs before modifying the backup. It then copies all affected existing files into a separate temporary folder and prints its location as `Original file backup:`. This backup includes the original images, feed, and changed JSON files. Originals are removed from the publishing directory, but these recovery copies remain outside it.

If installation raises an error, the script attempts to restore the original files. Keep the printed backup folder if you need recovery; the operating system may eventually clean temporary storage.

The manifest's `jpeg_processing` field records image quality and checksums. Re-running with the same quality skips matching JPEGs, while still allowing URLs to be changed. Changing quality or modifying an image causes it to be recompressed. JPEG compression is lossy; for a different quality setting, start from your original backup when possible.

## Troubleshooting

- **Missing `feed.xml` or `manifest.json`:** Point `folder` at the backup directory, not this script directory. In the packaged layout, that is `..` when running from here.
- **Missing manifest asset:** Restore the named file before running again.
- **No local asset mapping:** The feed references a podcast asset absent from the manifest. Add the matching downloaded file and manifest entry; the script will not invent a destination.
- **Conflicting JPEG destination:** Two images would share a `.jpg` filename. Resolve their names and manifest references before converting.
- **Missing cover download fails:** Check network access or download and register the cover in the manifest yourself.
- **`sips` is unavailable:** This version requires macOS.
- **Image conversion fails:** Original files are untouched if staging fails. Check that the source format is supported by `sips`.

A successful run exits with code `0`; validation or processing failures exit with a nonzero code. Files must still be uploaded separately, preserving their relative paths.
