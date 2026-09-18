import { XMLParser } from 'fast-xml-parser';

import { ERROR_MESSAGES, UserFacingError } from '../errors.js';

/**
 * A node in fast-xml-parser's `preserveOrder` output: one object whose single
 * non-metadata key is the tag name, with `:@` holding attributes.
 */
export type Node = Record<string, unknown>;
type TextNode = { '#text': string };

/**
 * The parser is configured to change nothing it does not have to.
 *
 * `trimValues`, `parseTagValue` and `parseAttributeValue` are all off because this
 * parse is used only to *find* things. The document that gets written is the
 * original text with URL substitutions applied, never a reserialization of this
 * tree, so any normalisation here would be a silent lie about the feed.
 */
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});

export function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTextNode(value: unknown): value is TextNode {
  return isObj(value) && '#text' in value;
}

/** The tag name as written in the document, prefix included. */
export function nodeName(node: Node): string {
  for (const key of Object.keys(node)) {
    if (key !== ':@' && key !== '#text') return key;
  }
  return '';
}

export function nodeChildren(node: Node): unknown[] {
  const name = nodeName(node);
  if (name === '') return [];
  const value = node[name];
  return Array.isArray(value) ? value : [];
}

export function nodeAttrs(node: Node): Record<string, string> {
  const raw = node[':@'];
  if (!isObj(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key.replace(/^@_/, '')] = String(value);
  }
  return out;
}

export function attr(node: Node, name: string): string {
  return nodeAttrs(node)[name] ?? '';
}

export function childNodes(node: Node): Node[] {
  return nodeChildren(node).filter((child): child is Node => isObj(child) && !isTextNode(child));
}

export function textOf(node: Node): string {
  return nodeChildren(node)
    .filter(isTextNode)
    .map((child) => child['#text'])
    .join('');
}

/** Every element in the document, depth-first, document order. */
export function walk(nodes: Node[]): Node[] {
  const out: Node[] = [];
  const visit = (list: Node[]): void => {
    for (const node of list) {
      if (nodeName(node) === '') continue;
      out.push(node);
      visit(childNodes(node));
    }
  };
  visit(nodes);
  return out;
}

/**
 * Prefix-to-URI map for the whole document.
 *
 * Namespaces are collected from every element rather than only the root. In
 * practice podcast feeds declare everything on `<rss>`, but a feed that declares
 * a prefix further down would otherwise have its elements silently ignored. A
 * prefix rebound to a different URI mid-document is not modelled; that is
 * legal XML but has never been seen in a podcast feed, and the cost of being
 * wrong is one asset missed, not a corrupted rewrite.
 */
export function collectNamespaces(nodes: Node[]): Map<string, string> {
  const prefixes = new Map<string, string>();
  for (const node of walk(nodes)) {
    for (const [name, value] of Object.entries(nodeAttrs(node))) {
      if (name === 'xmlns') prefixes.set('', value);
      else if (name.startsWith('xmlns:')) prefixes.set(name.slice(6), value);
    }
  }
  return prefixes;
}

export interface FeedDocument {
  nodes: Node[];
  /** The `<rss>` element. */
  root: Node;
  /** The `<channel>` element. */
  channel: Node;
  namespaces: Map<string, string>;
}

/**
 * Resolves an element's name to `{namespaceUri}local` form, the same Clark
 * notation the Python compared against.
 */
export function expandedName(node: Node, namespaces: Map<string, string>): string {
  const raw = nodeName(node);
  const colon = raw.indexOf(':');
  if (colon === -1) {
    const fallback = namespaces.get('');
    return fallback ? `{${fallback}}${raw}` : raw;
  }
  const prefix = raw.slice(0, colon);
  const local = raw.slice(colon + 1);
  const uri = namespaces.get(prefix);
  // An undeclared prefix cannot be resolved, so keep it verbatim rather than
  // guessing: matching nothing is safer than matching the wrong namespace.
  return uri ? `{${uri}}${local}` : raw;
}

/** True when `node` is `local` in namespace `uri`. */
export function isElement(node: Node, namespaces: Map<string, string>, uri: string, local: string): boolean {
  return expandedName(node, namespaces) === `{${uri}}${local}`;
}

export function parseFeed(xml: string): FeedDocument {
  let nodes: Node[];
  try {
    nodes = parser.parse(xml) as Node[];
  } catch {
    throw new UserFacingError(ERROR_MESSAGES.feedUnreadable);
  }
  if (!Array.isArray(nodes)) throw new UserFacingError(ERROR_MESSAGES.feedUnreadable);

  const root = nodes.find((node) => isObj(node) && nodeName(node) === 'rss');
  if (!root) throw new UserFacingError(ERROR_MESSAGES.feedUnreadable);

  const channel = childNodes(root).find((node) => nodeName(node) === 'channel');
  if (!channel) throw new UserFacingError(ERROR_MESSAGES.feedUnreadable);

  return { nodes, root, channel, namespaces: collectNamespaces(nodes) };
}

/** The `<item>` elements, in document order. */
export function items(doc: FeedDocument): Node[] {
  return childNodes(doc.channel).filter((node) => nodeName(node) === 'item');
}

/** Every `<guid>` text value in the document, in order. Used for the stability check. */
export function guids(doc: FeedDocument): string[] {
  return walk(doc.nodes)
    .filter((node) => nodeName(node) === 'guid')
    .map((node) => textOf(node));
}

export function channelTitle(doc: FeedDocument): string | null {
  const title = childNodes(doc.channel).find((node) => nodeName(node) === 'title');
  const text = title ? textOf(title).trim() : '';
  return text === '' ? null : text;
}
