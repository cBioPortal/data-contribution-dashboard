/**
 * Bibliographic metadata lookup for the "suggest a study" form.
 *
 * Given whatever the submitter pasted — a PMID, a DOI, a PubMed URL, a journal
 * URL — resolve the title, journal, author citation and publication year so the
 * form can offer to fill itself in.
 *
 * Europe PMC is the primary source: it resolves PMIDs and DOIs through one
 * endpoint, covers biomedical literature and preprints alike, and names
 * consortium authors explicitly rather than leaving them as an unlabelled blank.
 * Crossref is the fallback for DOIs Europe PMC has not indexed.
 *
 * This runs server-side even though all three APIs send permissive CORS. The
 * identifier parsing already lives here (see duplicateDetection), responses can
 * be cached across users, and a Crossref polite-pool contact or an NCBI key can
 * be added later without shipping either to the browser.
 */

import { normalizeIdentifier } from './duplicateDetection.js';
import logger from './logger.js';

const EUROPE_PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const CROSSREF = 'https://api.crossref.org/works';

// Upstream is a nice-to-have; the form must stay usable when it is slow.
const TIMEOUT_MS = 5000;

// Crossref asks callers to identify themselves in exchange for the faster,
// more reliable "polite" pool. Harmless if unset.
const CONTACT = process.env.LOOKUP_CONTACT_EMAIL || '';

// ─── Cache ───────────────────────────────────────────────────────────────────
// Bibliographic records for published work essentially never change, and the
// same handful of papers get pasted repeatedly. Bounded so a stream of junk
// identifiers cannot grow it without limit.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so the map evicts genuinely cold entries.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function getJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Accept: 'application/json',
      // Crossref reads the mailto out of the User-Agent for pool routing.
      'User-Agent': CONTACT
        ? `cbioportal-curation-dashboard (mailto:${CONTACT})`
        : 'cbioportal-curation-dashboard',
    },
  });
  // A 404 is an answer — "no record with that identifier" — not a failure of the
  // service. Treating it as one would report an unknown DOI as "try again
  // later" and, because failures are deliberately not cached, re-query upstream
  // on every keystroke.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

// ─── Author citation ─────────────────────────────────────────────────────────

/**
 * "Ravi et al." — the short citation the form's Authors field asks for.
 *
 * Built from each source's structured author list rather than its pre-formatted
 * string, so a compound surname ("van der Berg") survives intact and a
 * consortium is not handed a surname it does not have.
 *
 * A lone author gets no "et al." — there is nobody for it to stand in for. A
 * collective name (the Cancer Genome Atlas Network and its like) is a single
 * entity rather than a first author, so it is used whole.
 *
 * Exported for its own tests: the consortium, single-author and compound-surname
 * cases are easy to get wrong and not reachable through lookupPublication
 * without hitting the network.
 *
 * @param {Array<{lastName?: string, collective?: string}>} authors
 */
export function toAuthorCitation(authors) {
  const first = authors?.[0];
  if (!first) return '';
  if (first.collective) return first.collective;
  if (!first.lastName) return '';
  return authors.length > 1 ? `${first.lastName} et al.` : first.lastName;
}

/**
 * Last-resort parse of a formatted citation string, for the rare record that
 * carries no structured author list.
 *
 * "Ong E, Wong MU, Huffman A, He Y." -> Ong, Wong, Huffman, He. Trailing
 * initials are stripped by shape rather than by position, so "van der Berg JM"
 * yields "van der Berg" and not "van".
 */
export function authorsFromString(authorString) {
  return (authorString || '')
    .replace(/\.\s*$/, '')
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({ lastName: chunk.replace(/\s+[A-Z]{1,4}$/, '').trim(), collective: '' }));
}

// ─── Europe PMC ──────────────────────────────────────────────────────────────

/**
 * Europe PMC hit -> our form's field names.
 *
 * `journalTitle` at the top level is null even when the journal is known, so the
 * name has to come from journalInfo.journal.title. Preprints carry no journal at
 * all and name their server under bookOrReportDetails.publisher instead.
 */
function fromEuropePmc(hit) {
  const journal =
    hit.journalInfo?.journal?.title ||
    hit.bookOrReportDetails?.publisher ||
    '';

  const listed = (hit.authorList?.author || []).map((a) => ({
    lastName: a.lastName || '',
    collective: a.collectiveName || '',
  }));
  const authors = listed.length ? listed : authorsFromString(hit.authorString);

  return {
    paperTitle: (hit.title || '').replace(/\.$/, ''),
    journal,
    authors: toAuthorCitation(authors),
    publicationYear: hit.pubYear ? String(hit.pubYear) : '',
    pmid: hit.pmid || '',
    doi: hit.doi || '',
    // `PPR` is Europe PMC's source code for preprint servers, which lines up
    // with the published/preprint choice the submitter has already made.
    publicationType: hit.source === 'PPR' ? 'preprint' : 'published',
  };
}

/** Europe PMC query for a canonical `pmid:` / `doi:` identifier. */
function europePmcQuery(identifier) {
  if (identifier.startsWith('pmid:')) {
    return `EXT_ID:${identifier.slice(5)} AND SRC:MED`;
  }
  if (identifier.startsWith('doi:')) {
    // Quoted: DOIs contain slashes and punctuation the query parser would
    // otherwise treat as syntax.
    return `DOI:"${identifier.slice(4)}"`;
  }
  return null;
}

async function lookupEuropePmc(identifier) {
  const query = europePmcQuery(identifier);
  if (!query) return null;

  const url =
    `${EUROPE_PMC}?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=1`;
  const body = await getJson(url);
  const hit = body?.resultList?.result?.[0];
  return hit ? fromEuropePmc(hit) : null;
}

// ─── Crossref ────────────────────────────────────────────────────────────────

function fromCrossref(work) {
  // Only the surnames matter now that the field carries a short citation, so the
  // given names and their initials are dropped rather than assembled. A
  // consortium entry has neither `family` nor `given` and arrives as `name`.
  const authors = (work.author || []).map((a) => ({
    lastName: a.family || '',
    collective: a.family ? '' : (a.name || ''),
  }));

  const year =
    work.issued?.['date-parts']?.[0]?.[0] ??
    work['published-print']?.['date-parts']?.[0]?.[0] ??
    work['published-online']?.['date-parts']?.[0]?.[0];

  return {
    paperTitle: (work.title?.[0] || '').replace(/\.$/, ''),
    journal: work['container-title']?.[0] || work.publisher || '',
    authors: toAuthorCitation(authors),
    publicationYear: year ? String(year) : '',
    pmid: '',
    doi: work.DOI || '',
    publicationType: work.type === 'posted-content' ? 'preprint' : 'published',
  };
}

async function lookupCrossref(identifier) {
  if (!identifier.startsWith('doi:')) return null;
  const doi = identifier.slice(4);
  const body = await getJson(`${CROSSREF}/${encodeURIComponent(doi)}`);
  return body?.message ? fromCrossref(body.message) : null;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Resolve whatever the submitter pasted into form metadata.
 *
 * Never throws and never returns a partial failure the caller has to interpret:
 * every outcome is `{ found, ... }`, because the form must stay submittable by
 * hand whether the identifier was unrecognisable, genuinely absent upstream, or
 * the upstream was simply down.
 *
 * @param {string} raw whatever was typed into the PMID / URL field
 * @returns {Promise<{found: boolean, identifier: string|null, reason?: string,
 *                    source?: string, metadata?: object}>}
 */
export async function lookupPublication(raw) {
  const identifier = normalizeIdentifier(raw);

  // normalizeIdentifier falls through to "cleaned-up URL" for anything it does
  // not recognise, which is useful for duplicate matching but is not something
  // we can look up.
  //
  // Two very different situations end up here, and conflating them puts the
  // blame in the wrong place. A publisher link we have no rule for — Elsevier,
  // Wiley, anything that puts an internal id in the path instead of the DOI — is
  // a perfectly good link that we simply cannot read. Saying "that doesn't look
  // like an article link" tells the submitter they made a mistake when the gap
  // is ours.
  if (!identifier || !/^(pmid|doi):/.test(identifier)) {
    const looksLikeLink =
      /^https?:\/\//i.test(identifier ? raw.trim() : '') ||
      /^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(identifier || '');

    return {
      found: false,
      identifier: identifier || null,
      reason: looksLikeLink ? 'unsupported_link' : 'unrecognised_identifier',
    };
  }

  const cached = cacheGet(identifier);
  if (cached) return { ...cached, identifier, cached: true };

  let upstreamFailed = false;

  for (const [source, lookup] of [
    ['europepmc', lookupEuropePmc],
    ['crossref', lookupCrossref],
  ]) {
    try {
      const metadata = await lookup(identifier);
      if (metadata) {
        const result = { found: true, source, metadata };
        cacheSet(identifier, result);
        return { ...result, identifier };
      }
    } catch (err) {
      // A source being down is not a miss — remember the difference so the
      // caller can tell "no such paper" from "try again later", and do not
      // cache it either way.
      upstreamFailed = true;
      logger.warn(`Publication lookup via ${source} failed for ${identifier}: ${err.message}`);
    }
  }

  if (upstreamFailed) {
    return { found: false, identifier, reason: 'lookup_unavailable' };
  }

  const miss = { found: false, reason: 'not_found' };
  cacheSet(identifier, miss);
  return { ...miss, identifier };
}
