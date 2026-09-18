import { NS } from '../../constants.js';
import type { AssetKind } from '../../types.js';
import {
  attr,
  childNodes,
  expandedName,
  items,
  nodeName,
  textOf,
  walk,
  type FeedDocument,
  type Node,
} from './xmlnodes.js';

/** One migratable URL found in the feed. */
export interface UrlReference {
  url: string;
  kind: AssetKind;
  /** The episode GUID this belongs to, or null for a channel-level reference. */
  episodeGuid: string | null;
  /** Episode title, used to build a readable filename when the URL gives nothing. */
  episodeTitle: string | null;
  /** 1-based episode position in the feed, for `ep-007` style fallback names. */
  episodeIndex: number | null;
}

/**
 * The set of feed locations whose URLs are migrated.
 *
 * This is deliberately closed and matches the Python's `media_urls()` exactly.
 * Everything else a feed can hold a URL in -- `<link>`, `podcast:funding`,
 * `podcast:person/@img`, voicemail, the XSL stylesheet processing instruction,
 * `atom:link[@rel="hub"]` -- is left alone, which the README states as a
 * guarantee. Adding to this table changes that promise.
 */
const ATTRIBUTE_SITES: { uri: string; local: string; attribute: string; kind: AssetKind }[] = [
  { uri: '', local: 'enclosure', attribute: 'url', kind: 'audio' },
  { uri: NS.itunes, local: 'image', attribute: 'href', kind: 'image' },
  { uri: NS.podcast, local: 'transcript', attribute: 'url', kind: 'transcript' },
  { uri: NS.podcast, local: 'chapters', attribute: 'url', kind: 'chapters' },
  { uri: NS.psc, local: 'chapter', attribute: 'image', kind: 'chapter-image' },
];

/** Resolves a node against the table above, ignoring the prefix the feed happens to use. */
function siteFor(node: Node, namespaces: Map<string, string>): { attribute: string; kind: AssetKind } | null {
  const expanded = expandedName(node, namespaces);
  const bare = nodeName(node);

  for (const site of ATTRIBUTE_SITES) {
    if (site.uri === '') {
      // An unprefixed element in no default namespace, which is how RSS itself is written.
      if (bare === site.local && expanded === site.local) return site;
      continue;
    }
    if (expanded === `{${site.uri}}${site.local}`) return site;
  }
  return null;
}

/** Maps each element to the episode it sits inside, so assets can be named per episode. */
function episodeContext(doc: FeedDocument): Map<Node, { guid: string | null; title: string | null; index: number }> {
  const context = new Map<Node, { guid: string | null; title: string | null; index: number }>();

  items(doc).forEach((item, position) => {
    const children = childNodes(item);
    const guidNode = children.find((node) => nodeName(node) === 'guid');
    const titleNode = children.find((node) => nodeName(node) === 'title');
    const info = {
      guid: guidNode ? textOf(guidNode).trim() || null : null,
      title: titleNode ? textOf(titleNode).trim() || null : null,
      index: position + 1,
    };
    for (const node of walk([item])) context.set(node, info);
  });

  return context;
}

/**
 * Enumerates every migratable URL in the feed.
 *
 * Order is document order, which makes episode numbering and the resulting
 * filenames stable across runs of the same feed.
 */
export function discoverUrls(doc: FeedDocument): UrlReference[] {
  const found: UrlReference[] = [];
  const context = episodeContext(doc);

  for (const node of walk(doc.nodes)) {
    const episode = context.get(node);
    const base = {
      episodeGuid: episode?.guid ?? null,
      episodeTitle: episode?.title ?? null,
      episodeIndex: episode?.index ?? null,
    };

    const site = siteFor(node, doc.namespaces);
    if (site) {
      const url = attr(node, site.attribute).trim();
      if (url !== '') found.push({ url, kind: site.kind, ...base });
      continue;
    }

    // atom:link is only migratable when it is the feed's own self reference.
    // rel="hub", rel="alternate" and the rest are left alone.
    if (expandedName(node, doc.namespaces) === `{${NS.atom}}link` && attr(node, 'rel') === 'self') {
      const url = attr(node, 'href').trim();
      if (url !== '') found.push({ url, kind: 'feed', ...base });
    }
  }

  // The RSS 1.0-style <channel><image><url> cover, whose URL is element text
  // rather than an attribute.
  for (const image of childNodes(doc.channel).filter((node) => nodeName(node) === 'image')) {
    for (const urlNode of childNodes(image).filter((node) => nodeName(node) === 'url')) {
      const url = textOf(urlNode).trim();
      if (url !== '') {
        found.push({ url, kind: 'image', episodeGuid: null, episodeTitle: null, episodeIndex: null });
      }
    }
  }

  return found;
}

/**
 * The channel-level cover URLs.
 *
 * The Python fetched these separately because the backup it consumed sometimes
 * omitted the cover. Here they are already part of the discovered set; this is
 * kept so the plan can tell the user which image is the show artwork.
 */
export function channelCoverUrls(doc: FeedDocument): string[] {
  const urls: string[] = [];

  for (const node of childNodes(doc.channel)) {
    if (expandedName(node, doc.namespaces) === `{${NS.itunes}}image`) {
      const href = attr(node, 'href').trim();
      if (href !== '') urls.push(href);
    }
    if (nodeName(node) === 'image') {
      for (const urlNode of childNodes(node).filter((child) => nodeName(child) === 'url')) {
        const text = textOf(urlNode).trim();
        if (text !== '') urls.push(text);
      }
    }
  }

  return [...new Set(urls)];
}

/** `chapters[].img` URLs inside a downloaded Podlove chapters document. */
export function chapterImageUrls(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) return [];
  const chapters = (json as { chapters?: unknown }).chapters;
  if (!Array.isArray(chapters)) return [];

  const urls: string[] = [];
  for (const chapter of chapters) {
    if (typeof chapter !== 'object' || chapter === null) continue;
    const img = (chapter as { img?: unknown }).img;
    // `url` is deliberately skipped: it is a website link, and the Python
    // validates and rewrites only `img`.
    if (typeof img === 'string' && img.trim() !== '') urls.push(img.trim());
  }
  return urls;
}
