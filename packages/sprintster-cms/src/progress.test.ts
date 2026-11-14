import { describe, expect, it } from 'vitest';
import { progress } from './progress.js';

describe('progress', () => {
  it('logs each phase, and its count at most once a minute', () => {
    let t = 0;
    const lines: string[] = [];
    const p = progress((m) => lines.push(m), 60_000, () => t);
    p.say('rendering 3 pages');
    p.step('pages', 1, 3);
    t = 59_000;
    p.step('pages', 2, 3);
    t = 61_000;
    p.step('pages', 3, 3);
    t = 200_000;
    p.step('changes read', 500);
    expect(lines).toEqual(['rendering 3 pages', 'pages 3/3', 'changes read 500']);
  });

  it('is silent without a log', () => {
    expect(() => progress(undefined).say('x')).not.toThrow();
  });
});
