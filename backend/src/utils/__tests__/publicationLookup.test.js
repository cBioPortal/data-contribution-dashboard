import { toAuthorCitation, authorsFromString } from '../publicationLookup.js';

describe('toAuthorCitation', () => {
  it('names the first author and stands in for the rest', () => {
    expect(toAuthorCitation([
      { lastName: 'Ravi' }, { lastName: 'Hellmann' }, { lastName: 'Arniella' },
    ])).toBe('Ravi et al.');
  });

  it('omits "et al." when there is nobody else', () => {
    // "et al." stands in for further authors; with one there are none to stand for.
    expect(toAuthorCitation([{ lastName: 'Darwin' }])).toBe('Darwin');
  });

  it('uses a consortium name whole, without a surname or "et al."', () => {
    expect(toAuthorCitation([{ collective: 'Cancer Genome Atlas Network' }]))
      .toBe('Cancer Genome Atlas Network');
  });

  it('prefers a collective name over a surname on the same entry', () => {
    expect(toAuthorCitation([{ lastName: 'Smith', collective: 'ICGC Consortium' }]))
      .toBe('ICGC Consortium');
  });

  it('returns empty for no authors, rather than a stray "et al."', () => {
    expect(toAuthorCitation([])).toBe('');
    expect(toAuthorCitation(undefined)).toBe('');
    expect(toAuthorCitation([{}])).toBe('');
  });
});

describe('authorsFromString', () => {
  it('splits a formatted citation into surnames', () => {
    expect(authorsFromString('Ong E, Wong MU, Huffman A, He Y.').map(a => a.lastName))
      .toEqual(['Ong', 'Wong', 'Huffman', 'He']);
  });

  it('keeps compound surnames intact', () => {
    // Stripping by position would leave "van"; initials are removed by shape.
    expect(authorsFromString('van der Berg JM, Smith A').map(a => a.lastName))
      .toEqual(['van der Berg', 'Smith']);
  });

  it('leaves a consortium name alone', () => {
    const parsed = authorsFromString('Cancer Genome Atlas Network.');
    expect(parsed.map(a => a.lastName)).toEqual(['Cancer Genome Atlas Network']);
    expect(toAuthorCitation(parsed)).toBe('Cancer Genome Atlas Network');
  });

  it('handles empty input', () => {
    expect(authorsFromString('')).toEqual([]);
    expect(authorsFromString(undefined)).toEqual([]);
  });
});
