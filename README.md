# Podcast RSS Archiver

Prepare an existing podcast backup for a new hosting location on Windows, Linux, or macOS. This Python script uses Pillow to convert artwork to JPEG, rewrite podcast asset URLs, and keep the backup manifest in sync.

## GitHub description

A cross-platform Python tool that prepares podcast RSS backups for new hosting. Converts artwork to JPEG, updates feed and chapter URLs, syncs manifest metadata, and removes replaced images. Supports Windows, Linux, and macOS with configurable quality, dry runs, backups, and recovery.

This description is also saved in `description.txt` for copying into GitHub's About field.

## Requirements

- Windows, Linux, or macOS with Python 3.10 or newer.
- Pillow, installed using `requirements.txt`. No operating-system image conversion command is required.
- A podcast backup folder containing `feed.xml`, `manifest.json`, and the downloaded assets. The manifest must map original URLs to local files, as in this backup.
- Internet access only if the channel cover is missing and must be downloaded.

This script prepares an existing backup. It does not download an entire podcast or upload files to object storage.

## Installation

Open a terminal in the `podcast_rss_archiver` folder. Create a virtual environment and install the dependency.

**macOS or Linux:**

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

**Windows (PowerShell or Command Prompt):**

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe migrate_podcast.py "C:\path\to\backup" --dry-run
```

The examples below use `python3`. On Windows, use `.venv\Scripts\python.exe` instead and substitute your Windows folder path. Multiline examples use Bash syntax; on Windows, put the command on one line. If the Windows `py` launcher is unavailable, use `python` to create the environment.

The Pillow 12 dependency requires Python 3.10 or newer; see the [Pillow Python support table](https://pillow.readthedocs.io/en/stable/installation/python-support.html).

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
2. Converts images to RGB `.jpg` files at the chosen quality without resizing. EXIF orientation is applied, so rotated photographs may swap width and height. Transparent areas are composited onto white. Existing JPEGs are also recompressed unless the script previously processed the exact file at that quality.
3. Reopens and fully decodes each JPEG before installing it. PNG, JPEG, BMP, and static GIF/TIFF inputs are supported. WebP and AVIF support depends on the installed Pillow build. HEIC requires an additional decoder and is not supported by this script's default installation. Animated and multipage images are rejected before any original files are changed. RGB ICC profiles, EXIF metadata, and DPI are retained when available. See [Pillow's image format documentation](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html).
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
- **Pillow is missing:** Install `requirements.txt` using the same Python interpreter that runs the script. On Windows, use `.venv\Scripts\python.exe -m pip install -r requirements.txt`.
- **Dependency installation fails on an old Python version:** Use Python 3.10 or newer to create the virtual environment.
- **Image conversion fails:** Original files are untouched if staging fails. Check that the input is a valid, single-frame image supported by your Pillow installation. HEIC is not supported by the default installation.

A successful run exits with code `0`; validation or processing failures exit with a nonzero code. Files must still be uploaded separately, preserving their relative paths.

## Run the tests

After installing the dependency, run from this folder:

```bash
python3 -m unittest discover -s tests -v
```

On Windows:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Tests use temporary sample files and cover image conversion, transparency, orientation, invalid inputs, feed and chapter rewriting, repeat runs, and recovery after an installation failure.
