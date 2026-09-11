#!/usr/bin/env python3
"""Convert podcast artwork and migrate feed URLs using a backup manifest.

Requires Python 3.10+ and Pillow. Works on Windows, Linux, and macOS.
Install dependencies with: python -m pip install -r requirements.txt
Run with --help for options.

The folder must contain feed.xml and the manifest.json produced by the
podcast backup. Original download URLs are retained in the manifest;
hosted_url fields record the new URLs. Website, funding, voicemail,
stylesheet, XML namespace, and hub URLs are left alone.
"""

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from urllib.parse import quote, unquote, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


DEFAULT_BASE = "https://twp.us-ord-10.linodeobjects.com/"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif",
                    ".tif", ".tiff", ".bmp", ".heic"}
ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
ATOM = "{http://www.w3.org/2005/Atom}"
PODCAST = "{https://podcastindex.org/namespace/1.0}"
PSC = "{http://podlove.org/simple-chapters}"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def checked_path(root, relative):
    path = root / relative
    if Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError("Unsafe relative path: " + relative)
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        raise ValueError("Path escapes the podcast folder: " + relative)
    return path


def load_pillow():
    # Keep --help and --dry-run available before dependencies are installed.
    try:
        from PIL import Image, ImageOps
    except ImportError as error:
        raise ValueError(
            "Pillow is required for image conversion. Run: "
            "python -m pip install -r requirements.txt (from the script folder)"
        ) from error
    return Image, ImageOps


def convert_image(source, target, quality):
    Image, ImageOps = load_pillow()
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as original:
        if getattr(original, "n_frames", 1) != 1:
            raise ValueError("Animated or multipage image cannot become one JPEG: " + str(source))
        # Apply camera orientation before removing the orientation tag.
        with ImageOps.exif_transpose(original) as oriented:
            expected_size = oriented.size
            options = {"quality": quality, "optimize": True}
            exif = oriented.getexif()
            if exif:
                options["exif"] = exif.tobytes()
            if oriented.info.get("dpi"):
                options["dpi"] = oriented.info["dpi"]
            # A CMYK/grayscale profile is not valid for converted RGB pixels.
            if oriented.mode in {"RGB", "RGBA", "P"} and oriented.info.get("icc_profile"):
                options["icc_profile"] = oriented.info["icc_profile"]
            if "A" in oriented.getbands() or "transparency" in oriented.info:
                with oriented.convert("RGBA") as rgba, Image.new("RGB", oriented.size, "white") as rgb:
                    with rgba.getchannel("A") as alpha:
                        rgb.paste(rgba, mask=alpha)
                    rgb.save(target, format="JPEG", **options)
            else:
                with oriented.convert("RGB") as rgb:
                    rgb.save(target, format="JPEG", **options)
    # Reopen and fully decode the output before any original can be deleted.
    with Image.open(target) as result:
        result.load()
        if result.format != "JPEG" or result.mode != "RGB" or result.size != expected_size:
            raise ValueError("Image verification failed: " + str(source))


def media_urls(tree):
    for node in tree.iter():
        key = {
            "enclosure": "url", ITUNES + "image": "href",
            PODCAST + "transcript": "url", PODCAST + "chapters": "url",
            PSC + "chapter": "image",
        }.get(node.tag)
        if node.tag == ATOM + "link" and node.get("rel") == "self":
            key = "href"
        if key and node.get(key):
            yield node.get(key)
    for node in tree.findall("./channel/image/url"):
        if node.text:
            yield node.text.strip()


def run(args):
    root = args.folder.expanduser().resolve()
    base = args.base_url.rstrip("/") + "/"
    parsed = urlsplit(base)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc
            or parsed.query or parsed.fragment or parsed.username or parsed.password):
        raise ValueError("--base-url must be an HTTP(S) URL without credentials, query, or fragment")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    feed_before = (root / "feed.xml").read_text(encoding="utf-8")
    tree_before = ET.fromstring(feed_before)
    assets = manifest.setdefault("assets", [])
    records = (manifest.get("feeds", []) + assets
               + [a for ep in manifest.get("episodes", []) for a in ep.get("assets", [])])
    images = sorted(p for p in root.rglob("*")
                    if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
                    and not any(part.startswith(".") for part in p.relative_to(root).parts))
    conversions = []
    path_map = {}
    destinations = set()
    for source in images:
        relative = source.relative_to(root).as_posix()
        checked_path(root, relative)
        target = source.relative_to(root).with_suffix(".jpg").as_posix()
        if target in destinations or ((root / target).exists() and root / target != source):
            raise ValueError("Conflicting JPEG destination: " + target)
        destinations.add(target)
        path_map[relative] = target
        conversions.append((source, target))

    url_map = {}

    def hosted(relative):
        return base + quote(relative, safe="/")

    def add_mapping(old, new):
        if old:
            if old in url_map and url_map[old] != new:
                raise ValueError("One source URL maps to multiple files: " + old)
            url_map[old] = new

    for record in records:
        relative = record["file"]
        if not checked_path(root, relative).is_file():
            raise ValueError("Missing manifest asset: " + relative)
        target = path_map.get(relative, relative)
        for key in ("url", "resolved_url", "hosted_url"):
            add_mapping(record.get(key), hosted(target))
        add_mapping(hosted(relative), hosted(target))
    for key in ("feed_url", "hosted_feed_url"):
        add_mapping(manifest.get(key), hosted("feed.xml"))
    for node in tree_before.findall("./channel/" + ATOM + "link"):
        if node.get("rel") == "self":
            add_mapping(node.get("href"), hosted("feed.xml"))

    # The backup sometimes omits the channel cover. Fetch only that missing asset.
    covers = []
    for node in tree_before.findall("./channel/" + ITUNES + "image"):
        if node.get("href"):
            covers.append(node.get("href"))
    covers += [n.text.strip() for n in tree_before.findall("./channel/image/url") if n.text]
    downloads = []
    for url in dict.fromkeys(covers):
        if url in url_map:
            continue
        if args.no_download_cover:
            raise ValueError("Cover is missing from the manifest: " + url)
        if urlsplit(url).scheme not in {"https", "http"}:
            raise ValueError("Unsupported cover URL: " + url)
        name = "podcast-cover" if not downloads else "podcast-cover-" + str(len(downloads) + 1)
        relative = "images/" + name + ".jpg"
        if relative in destinations or (root / relative).exists():
            raise ValueError("Cannot overwrite an untracked cover: " + relative)
        destinations.add(relative)
        downloads.append((url, relative))
        add_mapping(url, hosted(relative))

    def replacement_map():
        mapping = dict(url_map)
        for old, new in url_map.items():
            mapping[html.escape(old, quote=True)] = html.escape(new, quote=True)
        return mapping

    replacements = replacement_map()
    pattern = re.compile("|".join(re.escape(s) for s in sorted(replacements, key=len, reverse=True)))

    def replace_urls(text):
        return pattern.sub(lambda m: replacements[m.group(0)], text) if replacements else text

    feed_after = replace_urls(feed_before)
    planned = {target for _, target in conversions + downloads}

    def validate_url(url):
        if not url.startswith(base):
            raise ValueError("No local asset mapping for: " + url)
        relative = unquote(url[len(base):])
        path = checked_path(root, relative)
        if relative not in planned and not path.is_file():
            raise ValueError("URL target does not exist: " + relative)

    def update_enclosure(match):
        tag = match.group(0)
        node = ET.fromstring(tag)
        url = node.get("url", "")
        validate_url(url)
        length = checked_path(root, unquote(url[len(base):])).stat().st_size
        if node.get("length") is None:
            raise ValueError("Enclosure has no length attribute: " + url)
        return re.sub(r"\blength\s*=\s*(['\"])\d+\1", 'length="' + str(length) + '"', tag)

    feed_after = re.sub(r"<enclosure\b[^>]*?/>", update_enclosure, feed_after)
    tree_after = ET.fromstring(feed_after)
    urls = list(media_urls(tree_after))
    for url in urls:
        validate_url(url)
    if ([n.text for n in tree_before.findall(".//guid")]
            != [n.text for n in tree_after.findall(".//guid")]):
        raise ValueError("Episode GUIDs changed unexpectedly")
    metadata = {"feed.xml": feed_after}
    chapter_count = 0
    for path in sorted((root / "chapters").glob("*.json")):
        before = path.read_text(encoding="utf-8")
        after = replace_urls(before)
        chapter_data = json.loads(after)
        for chapter in chapter_data.get("chapters", []):
            if chapter.get("img"):
                validate_url(chapter["img"])
        if before != after:
            metadata[path.relative_to(root).as_posix()] = after
            chapter_count += 1

    # Skip images already processed by this script at the requested quality.
    previous = manifest.get("jpeg_processing", {})
    process = []
    skipped = 0
    for source, relative in conversions:
        prior = previous.get(relative, {})
        if (source == root / relative and prior.get("quality") == args.quality
                and prior.get("sha256") == sha256(source)):
            skipped += 1
        else:
            process.append((source, relative))
    print("Folder:", root)
    print("Base URL:", base)
    print("JPEG quality:", args.quality)
    print("Images to convert: {}; already processed: {}; covers to download: {}".format(
        len(process), skipped, len(downloads)))
    print("Feed references validated: {}; chapter files to update: {}".format(len(urls), chapter_count))
    if args.dry_run:
        print("Dry run complete. No files changed or downloaded.")
        return
    if process or downloads:
        load_pillow()

    with tempfile.TemporaryDirectory(prefix="podcast-stage-") as temporary:
        stage = Path(temporary)
        for index, (url, relative) in enumerate(downloads):
            source = stage / ("download-" + str(index))
            print("Downloading missing cover:", url, flush=True)
            with urlopen(Request(url, headers={"User-Agent": "PodcastMigration/1.0"}), timeout=60) as response:
                with source.open("wb") as output:
                    shutil.copyfileobj(response, output)
            process.append((source, relative))
            record = {"kind": "images", "url": url, "resolved_url": url,
                      "file": relative, "status": "downloaded"}
            assets.append(record)
            records.append(record)
        original_bytes = sum(source.stat().st_size for source, _ in process)
        for index, (source, relative) in enumerate(process, 1):
            convert_image(source, stage / relative, args.quality)
            previous[relative] = {"quality": args.quality, "sha256": sha256(stage / relative)}
            print("Verified JPEG {}/{}: {}".format(index, len(process), relative), flush=True)
        for relative, text in metadata.items():
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        for record in records:
            record["file"] = path_map.get(record["file"], record["file"])
            relative = record["file"]
            record["hosted_url"] = hosted(relative)
            if (stage / relative).is_file():
                record["bytes"] = (stage / relative).stat().st_size
                record["sha256"] = sha256(stage / relative)
            if relative.endswith(".jpg"):
                record["content_type"] = "image/jpeg"
        manifest["hosted_feed_url"] = hosted("feed.xml")
        manifest["jpeg_processing"] = previous
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        targets = [relative for _, relative in process] + list(metadata) + ["manifest.json"]
        # Delete replaced non-JPEG originals only after images and metadata are installed.
        obsolete = [source.relative_to(root).as_posix() for source, target in conversions
                    if source != root / target]
        affected = set(targets + obsolete)
        existed = {relative for relative in affected if (root / relative).is_file()}
        backup = Path(tempfile.mkdtemp(prefix="podcast-originals-"))
        print("Original file backup:", backup, flush=True)
        for relative in existed:
            (backup / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / relative, backup / relative)
        try:
            for relative in targets:
                target = checked_path(root, relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                # Atomic replacement on the destination filesystem.
                fd, pending = tempfile.mkstemp(prefix=".podcast-", dir=str(target.parent))
                os.close(fd)
                try:
                    shutil.copy2(stage / relative, pending)
                    os.replace(pending, target)
                finally:
                    if os.path.exists(pending):
                        os.unlink(pending)
                if sha256(target) != sha256(stage / relative):
                    raise ValueError("Written file failed verification: " + relative)
            for relative in obsolete:
                (root / relative).unlink()
        except BaseException:
            print("Migration failed; restoring original files from", backup, file=sys.stderr)
            for relative in existed:
                shutil.copy2(backup / relative, root / relative)
            for relative in affected - existed:
                if (root / relative).is_file():
                    (root / relative).unlink()
            raise
        new_bytes = sum((root / relative).stat().st_size for _, relative in process)
        print("Done: {} JPEGs written; {} replaced originals removed.".format(len(process), len(obsolete)))
        if original_bytes:
            print("Processed images: {:.1f} MB -> {:.1f} MB ({:.1f}% smaller).".format(
                original_bytes / 1e6, new_bytes / 1e6, 100 * (1 - new_bytes / original_bytes)))
        print("Files are ready to upload. Nothing was uploaded.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", nargs="?", type=Path, default=Path.cwd(),
                        help="podcast backup folder (default: current directory)")
    parser.add_argument("--base-url", default=DEFAULT_BASE, help="new hosting URL prefix")
    parser.add_argument("--quality", type=int, default=90, help="JPEG quality, 1-100 (default: 90)")
    parser.add_argument("--dry-run", action="store_true", help="validate and show the plan without changing files or downloading")
    parser.add_argument("--no-download-cover", action="store_true", help="fail if channel artwork is missing locally")
    args = parser.parse_args()
    if not 1 <= args.quality <= 100:
        parser.error("--quality must be between 1 and 100")
    try:
        run(args)
    except (OSError, ValueError, KeyError, ET.ParseError) as error:
        print("Error:", error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
