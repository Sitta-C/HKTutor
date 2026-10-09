import { describe, expect, it } from 'vitest';

import { splitMessageLinks } from '@/lib/conversation-links';

describe('plain-text conversation links', () => {
  it('links explicit web URLs and www addresses without changing the original message', () => {
    const text =
      'ดูเอกสาร https://example.test/a?x=1&y=2#notes\nHTTP://example.test/home และ www.example.test';
    const parts = splitMessageLinks(text);
    expect(parts.map((part) => part.text).join('')).toBe(text);
    expect(parts.filter((part) => part.href).map((part) => part.href)).toEqual([
      'https://example.test/a?x=1&y=2#notes',
      'HTTP://example.test/home',
      'https://www.example.test',
    ]);
    for (const part of parts) {
      expect(text.slice(part.start, part.start + part.text.length)).toBe(part.text);
    }
  });

  it.each([
    ['(https://example.test/lesson_(math)).', 'https://example.test/lesson_(math)'],
    ['[https://example.test/lesson?q=(math)]!', 'https://example.test/lesson?q=(math)'],
    ['“https://example.test/lesson”,', 'https://example.test/lesson'],
    ['https://example.test/lesson。', 'https://example.test/lesson'],
    ['https://example.test/lesson?x=1&y=2#read', 'https://example.test/lesson?x=1&y=2#read'],
    ['https://例え.テスト/บทเรียน', 'https://例え.テスト/บทเรียน'],
    ['http://[::1]:3000/lesson', 'http://[::1]:3000/lesson'],
  ])('keeps sentence punctuation outside %s', (text, href) => {
    const parts = splitMessageLinks(text);
    expect(parts.filter((part) => part.href).map((part) => part.href)).toEqual([href]);
    expect(parts.map((part) => part.text).join('')).toBe(text);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'mailto:teacher@example.test',
    'javascript:https://example.test',
    'nothttps://example.test',
    'teacher@www.example.test',
    'https://trusted.test@other.test',
    'https://user:password@example.test',
    'https://example.test\\@other.test',
    'https://example.test:99999',
    'https://',
    'www.',
  ])('leaves unsafe, misleading or malformed candidates as text: %s', (text) => {
    const parts = splitMessageLinks(text);
    expect(parts.every((part) => part.href === null)).toBe(true);
    expect(parts.map((part) => part.text).join('')).toBe(text);
  });

  it('preserves HTML-looking text, emoji, whitespace and empty messages', () => {
    const text = '<img src=x onerror=alert(1)>\n😀  สวัสดี\nhttps://example.test/?q=%3Cscript%3E';
    const parts = splitMessageLinks(text);
    expect(parts.map((part) => part.text).join('')).toBe(text);
    expect(parts.filter((part) => part.href)).toHaveLength(1);
    expect(splitMessageLinks('')).toEqual([]);
    expect(splitMessageLinks('  \n ')).toEqual([{ text: '  \n ', start: 0, href: null }]);
  });
});
