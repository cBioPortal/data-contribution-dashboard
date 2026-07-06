/**
 * Duplicate Detection Utilities
 *
 * Identifies potential duplicate submissions via:
 *   Layer 1 — PMID / DOI / URL exact match (hard block)
 *   Layer 2 — Title similarity via token overlap (soft warning)
 */

// ─── Identifier normalizer ───────────────────────────────────────────────────
// Extracts a canonical identifier from PMIDs, DOIs, PubMed URLs, journal URLs,
// or generic data-source URLs. Used for hard duplicate detection.
export function normalizeIdentifier(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;

  // Extract DOI from journal URLs and doi.org
  const doiPatterns = [
    /(?:https?:\/\/)?(?:www\.)?doi\.org\/(10\.[^\s]+)/i,
    /(?:https?:\/\/)?(?:www\.)?nature\.com\/articles\/(10\.[^\s\/]+[^\s]*)/i,
    /(?:https?:\/\/)?(?:www\.)?nejm\.org\/doi\/(10\.[^\s]+)/i,
    /(?:https?:\/\/)?(?:www\.)?science\.org\/doi\/(10\.[^\s]+)/i,
    /(?:https?:\/\/)?(?:www\.)?aacrjournals\.org\/[^\/]+\/article\/(10\.[^\s]+)/i,
    /(?:https?:\/\/)?(?:www\.)?cell\.com\/[^\/]+\/fulltext\/(S[0-9()-]+)/i,
    /(10\.\d{4,9}\/[^\s]+)/i,  // bare DOI anywhere in the string
  ];
  for (const re of doiPatterns) {
    const m = s.match(re);
    if (m) return 'doi:' + m[1].toLowerCase().replace(/\/+$/, '');
  }

  // PubMed URLs
  const pubmedPatterns = [
    /(?:https?:\/\/)?(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/?(\d+)/i,
    /(?:https?:\/\/)?(?:www\.)?ncbi\.nlm\.nih\.gov\/pubmed\/?(\d+)/i,
  ];
  for (const re of pubmedPatterns) {
    const m = s.match(re);
    if (m) return 'pmid:' + m[1];
  }

  // Bare PMID (with or without 'PMID:' prefix)
  const pmidPrefix = s.replace(/^pmid[:\s]*/i, '').trim();
  if (/^\d+$/.test(pmidPrefix)) return 'pmid:' + pmidPrefix;

  // Normalize generic URLs: lowercase, strip protocol/www/trailing slashes
  return s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

// ─── Title similarity ─────────────────────────────────────────────────────────
// Token-overlap (Jaccard) similarity between two titles.
// Returns a number between 0 and 1.

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'for', 'and', 'or', 'to', 'with', 'by',
  'on', 'at', 'from', 'is', 'are', 'was', 'were', 'its', 'this', 'that',
  'et', 'al', 'using', 'via', 'into', 'as',
]);

function tokenize(title) {
  if (!title) return new Set();
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')   // strip punctuation
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w))
  );
}

export function titleSimilarity(titleA, titleB) {
  const a = tokenize(titleA);
  const b = tokenize(titleB);
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  // Jaccard = |A ∩ B| / |A ∪ B|
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ─── Build identifier set ─────────────────────────────────────────────────────
export function getSubmissionIdentifiers(sub) {
  const ids = new Set();
  if (sub.publicationType !== 'published') return ids;
  for (const field of [sub.pmid, sub.associatedPaper, sub.linkToData]) {
    const n = normalizeIdentifier(field);
    if (n) ids.add(n);
  }
  return ids;
}

// ─── Get submission title ─────────────────────────────────────────────────────
export function getSubmissionTitle(sub) {
  return sub.paperTitle || sub.studyName || '';
}

// Similarity threshold for soft warnings
const SIMILARITY_THRESHOLD = 0.55;

// ─── Hard conflict detection (PMID / DOI / URL) ──────────────────────────────
// `submissions` is an array of submission documents (each carrying its `id`).
export function findConflict(submissions, newType, incomingIds) {
  if (!incomingIds.size) return null;

  let bestConflict = null;

  for (const sub of submissions) {
    if (sub.publicationType !== 'published') continue;

    const existingIds = getSubmissionIdentifiers(sub);
    const overlap = [...incomingIds].some(id => existingIds.has(id));
    if (!overlap) continue;

    const conflict = {
      existingId: sub.id,
      existingType: sub.submissionType,
      existingTitle: getSubmissionTitle(sub),
      existingStatus: sub.displayStatus || sub.status || '',
    };

    if (sub.submissionType === 'submit-data') return conflict;
    bestConflict = conflict;
  }

  return bestConflict;
}

// ─── Soft duplicate detection (title similarity) ─────────────────────────────
// Scans all submissions and returns the best title match above threshold.
export function findSimilarByTitle(submissions, incomingTitle) {
  if (!incomingTitle || incomingTitle.trim().length < 5) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const sub of submissions) {
    const existingTitle = getSubmissionTitle(sub);
    if (!existingTitle) continue;

    const score = titleSimilarity(incomingTitle, existingTitle);
    if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
      bestScore = score;
      bestMatch = {
        existingId: sub.id,
        existingType: sub.submissionType,
        existingTitle,
        existingStatus: sub.displayStatus || sub.status || '',
        similarityScore: Math.round(score * 100),
      };
    }
  }

  return bestMatch;
}
