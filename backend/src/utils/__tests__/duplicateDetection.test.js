import { normalizeIdentifier, findConflict } from '../duplicateDetection.js';

/** The canonical DOI two different links to the same paper must both reduce to. */
const NATURE_GENETICS = 'doi:10.1038/s41588-023-01355-5';
const PREPRINT = 'doi:10.1101/2020.03.20.000141';

describe('normalizeIdentifier — Nature article URLs', () => {
  // Nature puts the article id in the URL, never the DOI. The rule this replaced
  // looked for `10.` after /articles/ and so matched a shape Nature has never
  // published: every real Nature link fell through to the opaque-URL branch,
  // invisible to duplicate detection.
  it('recovers the DOI from a modern article id', () => {
    expect(normalizeIdentifier('https://www.nature.com/articles/s41588-023-01355-5'))
      .toBe(NATURE_GENETICS);
  });

  it('recovers the DOI from a legacy article id', () => {
    expect(normalizeIdentifier('https://www.nature.com/articles/nature11412'))
      .toBe('doi:10.1038/nature11412');
    expect(normalizeIdentifier('https://www.nature.com/articles/ng.3691'))
      .toBe('doi:10.1038/ng.3691');
  });

  it('still accepts a DOI written into the path', () => {
    expect(normalizeIdentifier('https://www.nature.com/articles/10.1038/nature11412'))
      .toBe('doi:10.1038/nature11412');
  });

  it('ignores deep links, query strings and fragments', () => {
    for (const url of [
      'https://www.nature.com/articles/s41588-023-01355-5/figures/1',
      'https://www.nature.com/articles/s41588-023-01355-5?utm_source=x',
      'https://www.nature.com/articles/s41588-023-01355-5#Sec3',
      'nature.com/articles/s41588-023-01355-5/',
    ]) {
      expect(normalizeIdentifier(url)).toBe(NATURE_GENETICS);
    }
  });
});

describe('normalizeIdentifier — preprint versions', () => {
  // v1 and v2 are revisions of one preprint, not two papers.
  it('drops the version marker from bioRxiv and medRxiv links', () => {
    expect(normalizeIdentifier('https://www.biorxiv.org/content/10.1101/2020.03.20.000141v1'))
      .toBe(PREPRINT);
    expect(normalizeIdentifier('https://www.biorxiv.org/content/10.1101/2020.03.20.000141v2.full'))
      .toBe(PREPRINT);
    expect(normalizeIdentifier('https://www.medrxiv.org/content/10.1101/2021.01.01.21249123v3'))
      .toBe('doi:10.1101/2021.01.01.21249123');
  });

  it('agrees with the bare DOI, so revisions collide with it', () => {
    expect(normalizeIdentifier('10.1101/2020.03.20.000141')).toBe(PREPRINT);
  });

  it('leaves a trailing v-number alone outside the preprint prefix', () => {
    // Only 10.1101 uses this as versioning; elsewhere it may be part of the DOI.
    expect(normalizeIdentifier('10.1234/journal.v1')).toBe('doi:10.1234/journal.v1');
  });
});

describe('normalizeIdentifier — unchanged behaviour', () => {
  it('keeps handling the identifier forms it already did', () => {
    expect(normalizeIdentifier('23000897')).toBe('pmid:23000897');
    expect(normalizeIdentifier('PMID: 23000897')).toBe('pmid:23000897');
    expect(normalizeIdentifier('https://pubmed.ncbi.nlm.nih.gov/36959362/')).toBe('pmid:36959362');
    expect(normalizeIdentifier('https://doi.org/10.1038/nature11412')).toBe('doi:10.1038/nature11412');
    expect(normalizeIdentifier('https://www.nejm.org/doi/10.1056/NEJMoa2035389'))
      .toBe('doi:10.1056/nejmoa2035389');
  });

  it('falls back to a cleaned-up URL for anything unrecognised', () => {
    expect(normalizeIdentifier('https://www.example.org/some/paper/'))
      .toBe('example.org/some/paper');
  });

  it('returns null for empty or non-string input', () => {
    expect(normalizeIdentifier('')).toBeNull();
    expect(normalizeIdentifier('   ')).toBeNull();
    expect(normalizeIdentifier(null)).toBeNull();
    expect(normalizeIdentifier(42)).toBeNull();
  });
});

describe('findConflict — the duplicate these fixes actually catch', () => {
  const existing = [{
    id: 'submission_1',
    publicationType: 'published',
    submissionType: 'suggest-paper',
    paperTitle: 'Genomic and transcriptomic analysis',
    displayStatus: 'In Portal',
    pmid: 'https://www.nature.com/articles/s41588-023-01355-5',
  }];

  it('matches a Nature link against the same paper submitted by DOI', () => {
    const incoming = new Set([normalizeIdentifier('10.1038/s41588-023-01355-5')]);
    expect(findConflict(existing, 'suggest-paper', incoming)?.existingId).toBe('submission_1');
  });

  it('matches two different Nature URL shapes for one paper', () => {
    const incoming = new Set([
      normalizeIdentifier('https://www.nature.com/articles/s41588-023-01355-5/figures/1'),
    ]);
    expect(findConflict(existing, 'suggest-paper', incoming)?.existingId).toBe('submission_1');
  });

  it('does not match an unrelated paper', () => {
    const incoming = new Set([normalizeIdentifier('10.1038/nature11412')]);
    expect(findConflict(existing, 'suggest-paper', incoming)).toBeNull();
  });
});
