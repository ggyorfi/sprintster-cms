import { describe, expect, it } from 'vitest';
import { date, fallback, join, size, slugify, strip_html, truncate, truncatewords, where } from './filters.js';

describe('date', () => {
  it('formats in UTC with strftime codes', () => {
    expect(date('2026-07-13T09:00:00Z', '%B %e, %Y')).toBe('July 13, 2026');
    expect(date('2026-07-13T09:00:00Z', '%Y-%m-%d')).toBe('2026-07-13');
    expect(date('2026-07-13T09:00:00Z', '%a %H:%M')).toBe('Mon 09:00');
  });

  it('is empty for a value that is not a date', () => {
    expect(date(null)).toBe('');
    expect(date('not a date')).toBe('');
  });

  it('leaves an unknown code alone', () => {
    expect(date('2026-07-13T00:00:00Z', '%Q')).toBe('%Q');
  });
});

describe('text filters', () => {
  it('truncates to a length including the ellipsis', () => {
    expect(truncate('abcdefghij', 8)).toBe('abcde...');
    expect(truncate('short', 8)).toBe('short');
  });

  it('truncates by words', () => {
    expect(truncatewords('one two three four', 2)).toBe('one two...');
    expect(truncatewords('one two', 5)).toBe('one two');
  });

  it('strips tags', () => {
    expect(strip_html('<p>hello <b>there</b></p>')).toBe('hello there');
  });

  it('slugifies accents and punctuation', () => {
    expect(slugify('Héllo, World!')).toBe('hello-world');
  });
});

describe('value filters', () => {
  it('falls back only for blank values', () => {
    expect(fallback('', 'x')).toBe('x');
    expect(fallback([], 'x')).toBe('x');
    expect(fallback(0, 'x')).toBe(0);
    expect(fallback('set', 'x')).toBe('set');
  });

  it('sizes strings, arrays and objects', () => {
    expect(size('abc')).toBe(3);
    expect(size([1, 2])).toBe(2);
    expect(size({ a: 1 })).toBe(1);
    expect(size(null)).toBe(0);
  });

  it('joins with a glue string', () => {
    expect(join(['a', 'b'], ', ')).toBe('a, b');
  });

  it('filters by key and value', () => {
    const rows = [{ group: 'main' }, { group: 'footer' }];
    expect(where(rows, 'group', 'main')).toEqual([{ group: 'main' }]);
    expect(where(rows, 'group')).toHaveLength(2);
  });
});
