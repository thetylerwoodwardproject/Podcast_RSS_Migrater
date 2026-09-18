import { describe, expect, it } from 'vitest';

import {
  assertGuidsStable,
  buildReplacer,
  fixEnclosureLengths,
  htmlEscape,
  protectedRegions,
  readTagAttribute,
} from '../src/lib/server/feed/rewrite.js';

describe('htmlEscape', () => {
  it("emits &#x27; for an apostrophe, matching Python's html.escape", () => {
    // Not &#39;. A show-notes URL containing an apostrophe would fail to match if
    // this differed from what the source document was escaped with.
    expect(htmlEscape("a'b")).toBe('a&#x27;b');
  });

  it('escapes the full quote=True set', () => {
    expect(htmlEscape(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#x27;');
  });

  it('escapes the ampersand first, so nothing is double-escaped', () => {
    expect(htmlEscape('&lt;')).toBe('&amp;lt;');
  });
});

describe('buildReplacer', () => {
  it('replaces a mapped URL', () => {
    const replace = buildReplacer(new Map([['http://old/a.mp3', 'http://new/a.mp3']]));
    expect(replace('<enclosure url="http://old/a.mp3"/>')).toBe('<enclosure url="http://new/a.mp3"/>');
  });

  it('prefers the longest match, so a prefix URL cannot shadow a longer one', () => {
    // Without longest-first ordering, "http://old/a" would match inside
    // "http://old/a.mp3" and leave ".mp3" dangling on the replacement.
    const replace = buildReplacer(
      new Map([
        ['http://old/a', 'http://new/SHORT'],
        ['http://old/a.mp3', 'http://new/LONG.mp3'],
      ]),
    );
    expect(replace('x http://old/a.mp3 y')).toBe('x http://new/LONG.mp3 y');
  });

  it('rewrites a URL inside escaped HTML in a description', () => {
    // This is the reason the substitution is raw-text rather than XML-aware: no
    // tree rewriter would look inside an escaped href.
    const replace = buildReplacer(new Map([['http://old/a.jpg', 'http://new/a.jpg']]));
    const source = '<description>&lt;img src=&quot;http://old/a.jpg&quot;&gt;</description>';
    expect(replace(source)).toContain('http://new/a.jpg');
  });

  it('rewrites a URL inside a CDATA block', () => {
    const replace = buildReplacer(new Map([['http://old/a.jpg', 'http://new/a.jpg']]));
    const source = '<description><![CDATA[<img src="http://old/a.jpg">]]></description>';
    expect(replace(source)).toContain('http://new/a.jpg');
  });

  it('leaves unmapped URLs completely alone', () => {
    const replace = buildReplacer(new Map([['http://old/a.mp3', 'http://new/a.mp3']]));
    const source = '<podcast:funding url="https://donate.example.com/">Support</podcast:funding>';
    expect(replace(source)).toBe(source);
  });

  it('returns the document byte-identical when nothing maps', () => {
    const source = '<rss><channel><title>Show</title></channel></rss>';
    expect(buildReplacer(new Map())(source)).toBe(source);
  });

  it('escapes regex metacharacters in URLs', () => {
    const replace = buildReplacer(new Map([['http://old/a+b(1).mp3', 'http://new/ok.mp3']]));
    expect(replace('http://old/a+b(1).mp3')).toBe('http://new/ok.mp3');
    // The literal must not be treated as a pattern that could match something else.
    expect(replace('http://old/aXb1.mp3')).toBe('http://old/aXb1.mp3');
  });
});

describe('protectedRegions', () => {
  it('finds comments and CDATA', () => {
    const xml = 'a<!-- c -->b<![CDATA[d]]>e';
    const regions = protectedRegions(xml);
    expect(regions).toHaveLength(2);
    expect(xml.slice(regions[0]![0], regions[0]![1])).toBe('<!-- c -->');
    expect(xml.slice(regions[1]![0], regions[1]![1])).toBe('<![CDATA[d]]>');
  });
});

describe('readTagAttribute', () => {
  it('reads double- and single-quoted attributes', () => {
    expect(readTagAttribute('<enclosure url="http://a/b.mp3"/>', 'url')).toBe('http://a/b.mp3');
    expect(readTagAttribute("<enclosure url='http://a/b.mp3'/>", 'url')).toBe('http://a/b.mp3');
  });

  it('reads an attribute from a tag carrying a namespace prefix', () => {
    // The Python parsed the isolated tag with ElementTree, which throws
    // "unbound prefix" here because a fragment declares no namespaces.
    expect(readTagAttribute('<enclosure ns:foo="x" url="http://a/b.mp3"/>', 'url')).toBe(
      'http://a/b.mp3',
    );
  });

  it('unescapes entities in the value', () => {
    expect(readTagAttribute('<enclosure url="http://a/b.mp3?x=1&amp;y=2"/>', 'url')).toBe(
      'http://a/b.mp3?x=1&y=2',
    );
  });

  it('returns null for an absent attribute', () => {
    expect(readTagAttribute('<enclosure type="audio/mpeg"/>', 'url')).toBeNull();
  });
});

describe('fixEnclosureLengths', () => {
  const sizes = new Map([['http://new/a.mp3', 4242]]);
  const sizeOf = (url: string): number | null => sizes.get(url) ?? null;

  it('corrects the length on a self-closing tag', () => {
    const result = fixEnclosureLengths('<enclosure url="http://new/a.mp3" length="1"/>', sizeOf);
    expect(result.xml).toContain('length="4242"');
    expect(result.fixes[0]?.inserted).toBe(false);
  });

  it('corrects the length on a paired tag', () => {
    // The Python's regex only matched self-closing tags, so this whole form was
    // silently skipped and the stale length shipped.
    const result = fixEnclosureLengths(
      '<enclosure url="http://new/a.mp3" length="1"></enclosure>',
      sizeOf,
    );
    expect(result.xml).toContain('length="4242"');
  });

  it('preserves the original quote style', () => {
    const result = fixEnclosureLengths("<enclosure url='http://new/a.mp3' length='1'/>", sizeOf);
    expect(result.xml).toContain("length='4242'");
  });

  it('inserts a missing length rather than failing', () => {
    // The Python raised here. This app downloaded the file, so it knows the size.
    const result = fixEnclosureLengths('<enclosure url="http://new/a.mp3"/>', sizeOf);
    expect(result.xml).toContain('length="4242"');
    expect(result.fixes[0]?.inserted).toBe(true);
  });

  it('inserts a missing length on a paired tag', () => {
    const result = fixEnclosureLengths('<enclosure url="http://new/a.mp3"></enclosure>', sizeOf);
    expect(result.xml).toBe('<enclosure url="http://new/a.mp3" length="4242"></enclosure>');
  });

  it('leaves an enclosure inside CDATA alone', () => {
    // Prose about an enclosure is not an enclosure. Note the deliberate asymmetry
    // with URL substitution, which does reach into CDATA.
    const source = '<description><![CDATA[<enclosure url="http://new/a.mp3" length="1"/>]]></description>';
    expect(fixEnclosureLengths(source, sizeOf).xml).toBe(source);
  });

  it('leaves an enclosure inside a comment alone', () => {
    const source = '<!-- <enclosure url="http://new/a.mp3" length="1"/> -->';
    expect(fixEnclosureLengths(source, sizeOf).xml).toBe(source);
  });

  it('reports a URL whose local size is unknown and changes nothing', () => {
    const source = '<enclosure url="http://elsewhere/x.mp3" length="7"/>';
    const result = fixEnclosureLengths(source, sizeOf);
    expect(result.xml).toBe(source);
    expect(result.unresolved).toEqual(['http://elsewhere/x.mp3']);
  });
});

describe('assertGuidsStable', () => {
  it('accepts an unchanged list', () => {
    expect(() => assertGuidsStable(['a', 'b'], ['a', 'b'])).not.toThrow();
  });

  it('rejects a changed GUID', () => {
    expect(() => assertGuidsStable(['a', 'b'], ['a', 'c'])).toThrow(/GUID/);
  });

  it('rejects a different number of GUIDs', () => {
    expect(() => assertGuidsStable(['a'], ['a', 'b'])).toThrow(/GUID/);
  });
});
