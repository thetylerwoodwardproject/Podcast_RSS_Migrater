import { describe, expect, it } from 'vitest';

import { isPrivateAddress, normalizeBaseUrl, parseRemoteUrl } from '../src/lib/server/fetch.js';

describe('parseRemoteUrl', () => {
  it('accepts an ordinary http(s) URL', () => {
    expect(parseRemoteUrl('https://example.com/feed.xml').href).toBe('https://example.com/feed.xml');
    expect(parseRemoteUrl('http://example.com/feed.xml').href).toBe('http://example.com/feed.xml');
  });

  it('trims surrounding whitespace', () => {
    expect(parseRemoteUrl('  https://example.com/feed.xml  ').href).toBe('https://example.com/feed.xml');
  });

  // The server performs these requests, so a scheme that reads the local
  // filesystem or speaks to an arbitrary service is a real capability to deny.
  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com/', 'data:text/plain,hi'])(
    'refuses the %s scheme',
    (url) => {
      expect(() => parseRemoteUrl(url)).toThrow();
    },
  );

  it('refuses embedded credentials', () => {
    expect(() => parseRemoteUrl('http://user:pass@example.com/feed.xml')).toThrow();
    expect(() => parseRemoteUrl('http://user@example.com/feed.xml')).toThrow();
  });

  it('refuses something that is not a URL at all', () => {
    expect(() => parseRemoteUrl('not a url')).toThrow();
    expect(() => parseRemoteUrl('')).toThrow();
  });
});

describe('normalizeBaseUrl', () => {
  it('adds a trailing slash so callers can concatenate', () => {
    expect(normalizeBaseUrl('https://cdn.example.com/podcast')).toBe('https://cdn.example.com/podcast/');
  });

  it('collapses repeated trailing slashes', () => {
    expect(normalizeBaseUrl('https://cdn.example.com/podcast///')).toBe('https://cdn.example.com/podcast/');
  });

  it('accepts a bare origin', () => {
    expect(normalizeBaseUrl('https://cdn.example.com')).toBe('https://cdn.example.com/');
  });

  // Same rules the CLI applied to --base-url.
  it.each([
    ['a query string', 'https://cdn.example.com/?x=1'],
    ['a fragment', 'https://cdn.example.com/#x'],
    ['credentials', 'https://user:pass@cdn.example.com/'],
    ['a non-http scheme', 'ftp://cdn.example.com/'],
    ['an empty string', ''],
    ['nonsense', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(() => normalizeBaseUrl(url)).toThrow();
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    // The cloud metadata endpoint, the classic SSRF target.
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
  ])('treats %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.0.1'])(
    'treats %s as public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it.each(['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1'])(
    'treats the IPv6 address %s as private',
    (address) => {
      expect(isPrivateAddress(address)).toBe(true);
    },
  );

  it('treats a routable IPv6 address as public', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });
});
