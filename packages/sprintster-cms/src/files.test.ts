import { describe, expect, it } from 'vitest';
import { safeFileName } from './files.js';

describe('safeFileName', () => {
  it('keeps a plain name and folds accents, spaces and symbols', () => {
    expect(safeFileName('Carbon_Removals_Proposal.pdf')).toBe('Carbon_Removals_Proposal.pdf');
    expect(safeFileName('Életrajz (2025).pdf')).toBe('Eletrajz-2025-.pdf');
    expect(safeFileName('../../etc')).toBe('etc');
    expect(safeFileName('')).toBe('file');
  });
});
