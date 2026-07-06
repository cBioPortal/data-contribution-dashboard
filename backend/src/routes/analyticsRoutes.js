/**
 * Analytics Routes
 *
 * Serves read-only analytics data from ClickHouse (database set via CLICKHOUSE_DATABASE)
 * All routes are public (no auth required) — read-only queries
 */

import express from 'express';
import fetch from 'node-fetch';
import { clickhouseClient } from '../db/index.js';
import { listSubmissions } from '../db/submissions.js';

const router = express.Router();
const CH_DB = process.env.CLICKHOUSE_DATABASE || 'cbioportal_public_blue';

// Year extraction SQL expression — exactly mirrors frontend extractYearFromStudy():
// 1. Parse year from citation
// 2. Parse year from name
// 3. TCGA Firehose Legacy → 2011
// 4. Any name containing 'gdc' (TCGA/TARGET/CPTAC GDC studies) → 2024
// 5. Parse year from cancer_study_identifier (studyId)
// 6. Fallback → 2026
const YEAR_EXPR = [
  "multiIf(",
  "  match(cs.citation, '\\\\b(20\\\\d{2}|19\\\\d{2})\\\\b'),",
  "  toInt32(extract(cs.citation, '\\\\b(20\\\\d{2}|19\\\\d{2})\\\\b')),",
  "  match(cs.name, '\\\\b(20\\\\d{2}|19\\\\d{2})\\\\b'),",
  "  toInt32(extract(cs.name, '\\\\b(20\\\\d{2}|19\\\\d{2})\\\\b')),",
  "  positionCaseInsensitive(cs.name, 'firehose legacy') > 0,",
  "  2011,",
  "  positionCaseInsensitive(cs.name, 'gdc') > 0,",
  "  2024,",
  "  match(cs.cancer_study_identifier, '\\\\b(20\\\\d{2}|19\\\\d{2})\\\\b'),",
  "  toInt32(extract(cs.cancer_study_identifier, '\\\\b(20\\\\d{2}|19\\\\d{2})\\\\b')),",
  "  2026",
  ")",
].join('\n');

/**
 * GET /api/analytics/cancer-type-samples
 */
router.get('/cancer-type-samples', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const result = await clickhouseClient.query({
      query: `
        SELECT
          csamp.attr_value                    AS name,
          COUNT(DISTINCT csamp.internal_id)   AS samples,
          COUNT(DISTINCT p.cancer_study_id)   AS studies
        FROM ${CH_DB}.clinical_sample csamp
        JOIN ${CH_DB}.sample s ON csamp.internal_id = s.internal_id
        JOIN ${CH_DB}.patient p ON s.patient_id = p.internal_id
        WHERE csamp.attr_id = 'CANCER_TYPE'
        GROUP BY csamp.attr_value
        ORDER BY samples DESC
        LIMIT ${limit}
      `,
      format: 'JSONEachRow',
    });

    const rows = await result.json();
    res.json({
      status: 'success',
      data: rows.map(row => ({
        cancerTypeId: row.name.toLowerCase().replace(/\s+/g, '_'),
        name: row.name,
        samples: Number(row.samples),
        studies: Number(row.studies),
      }))
    });
  } catch (error) {
    console.error('ClickHouse query error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch cancer type samples' });
  }
});

/**
 * GET /api/analytics/study-sample-counts
 */
router.get('/study-sample-counts', async (req, res) => {
  try {
    const result = await clickhouseClient.query({
      query: `
        SELECT cancer_study_identifier AS studyId, count(*) AS sampleCount
        FROM ${CH_DB}.sample_derived
        GROUP BY cancer_study_identifier
      `,
      format: 'JSONEachRow',
    });

    const rows = await result.json();
    const lookup = {};
    rows.forEach(row => { lookup[row.studyId] = Number(row.sampleCount); });
    res.json({ status: 'success', data: lookup });
  } catch (error) {
    console.error('ClickHouse study sample counts error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch study sample counts' });
  }
});

// ─── Cumulative growth: study release years from the cBioPortal News.md ───────
// Release dates are parsed from the raw News.md markdown (each study's earliest
// appearance under a `## <Date>` heading), then cross-referenced with the study
// list. Studies not found in the news fall back to, in order: Firehose Legacy →
// 2011, a year in the study name, a year in the study id.
const NEWS_MD_URL =
  'https://raw.githubusercontent.com/cBioPortal/cbioportal/refs/heads/master/docs/News.md';
const NEWS_CACHE_TTL_MS = 60 * 60 * 1000; // re-fetch News.md at most hourly
let _newsCache = { at: 0, releaseYears: null };

// Studies released before this year are bucketed into it on the growth chart.
const GROWTH_MIN_YEAR = 2011;

// First 4-digit year (1900–2099) found in a string, or null. The boundary uses
// digit-only lookaround (not \b) so years after an underscore are recognised —
// e.g. the `2013` in a study id like `mbn_mdacc_2013`.
function extractYear(str) {
  const m = String(str || '').match(/(?<![0-9])(?:19|20)\d{2}(?![0-9])/);
  return m ? Number(m[0]) : null;
}

/**
 * Parse study release years from News.md.
 * @returns {Promise<Object>} { [studyId]: earliestYear }
 */
async function fetchNewsReleaseYears() {
  if (_newsCache.releaseYears && Date.now() - _newsCache.at < NEWS_CACHE_TTL_MS) {
    return _newsCache.releaseYears;
  }

  const resp = await fetch(NEWS_MD_URL, { headers: { 'User-Agent': 'portal-dashboard' } });
  if (!resp.ok) throw new Error(`News.md fetch failed: ${resp.status}`);
  const md = await resp.text();

  // Split on `## <Date>` headings; within each dated section pull study ids out
  // of cbioportal.org/study?id=... links and keep the earliest year seen.
  const headingRe = /^## (.+)$/gm;
  const studyRe = /cbioportal\.org\/study(?:\/summary)?\?id=([A-Za-z0-9_%-]+)/g;

  const headings = [...md.matchAll(headingRe)];
  const releaseYears = {};
  for (let i = 0; i < headings.length; i++) {
    const year = extractYear(headings[i][1]);
    if (!year) continue;
    const start = headings[i].index + headings[i][0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : md.length;
    const section = md.slice(start, end);

    let m;
    studyRe.lastIndex = 0;
    while ((m = studyRe.exec(section)) !== null) {
      let id;
      try { id = decodeURIComponent(m[1]); } catch { id = m[1]; }
      if (releaseYears[id] === undefined || year < releaseYears[id]) {
        releaseYears[id] = year;
      }
    }
  }

  _newsCache = { at: Date.now(), releaseYears };
  return releaseYears;
}

/**
 * Resolve a study's release year: News.md date first, then fallbacks.
 * @returns {number|null} the year, or null if none could be determined
 */
function resolveReleaseYear(studyId, name, newsYears) {
  const fromNews = newsYears[studyId];
  if (fromNews) return fromNews;                          // news
  if (/firehose legacy/i.test(name || '')) return 2011;   // Firehose Legacy fallback
  const fromName = extractYear(name);
  if (fromName) return fromName;                          // year in name
  const fromId = extractYear(studyId);
  if (fromId) return fromId;                              // year in study id
  return null;
}

/**
 * GET /api/analytics/cumulative-growth
 * Per-year new studies + samples, with release years derived from News.md.
 */
router.get('/cumulative-growth', async (req, res) => {
  try {
    const [newsYears, studyRows, sampleRows] = await Promise.all([
      fetchNewsReleaseYears(),
      clickhouseClient
        .query({
          query: `SELECT cancer_study_identifier AS studyId, name FROM ${CH_DB}.cancer_study`,
          format: 'JSONEachRow',
        })
        .then(r => r.json()),
      clickhouseClient
        .query({
          query: `
            SELECT cancer_study_identifier AS studyId, count(*) AS cnt
            FROM ${CH_DB}.sample_derived
            GROUP BY cancer_study_identifier
          `,
          format: 'JSONEachRow',
        })
        .then(r => r.json()),
    ]);

    const sampleCounts = {};
    sampleRows.forEach(r => { sampleCounts[r.studyId] = Number(r.cnt); });

    const perYear = {}; // year -> { studies, samples }
    let unknownYearCount = 0;
    for (const s of studyRows) {
      const resolved = resolveReleaseYear(s.studyId, s.name, newsYears);
      if (!resolved) { unknownYearCount++; continue; }
      // Pre-2011 studies are counted in the chart's first year rather than dropped.
      const year = Math.max(GROWTH_MIN_YEAR, resolved);
      if (!perYear[year]) perYear[year] = { studies: 0, samples: 0 };
      perYear[year].studies += 1;
      perYear[year].samples += sampleCounts[s.studyId] || 0;
    }

    const data = Object.keys(perYear)
      .map(Number)
      .sort((a, b) => a - b)
      .map(year => ({ year, studies: perYear[year].studies, samples: perYear[year].samples }));

    res.json({ status: 'success', data, unknownYearCount });
  } catch (error) {
    console.error('Cumulative growth (news-based) error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch cumulative growth data' });
  }
});

/**
 * GET /api/analytics/sample-counts-by-datatype?year=2018
 *
 * Two separate queries combined in JS:
 * - Non-mutation types: genetic_profile_samples.ordered_sample_list (comma-separated sample IDs)
 * - MUTATION_EXTENDED: mutation table (no sample list entry exists for this type)
 */
router.get('/sample-counts-by-datatype', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || 2018;

    const [nonMutResult, mutResult] = await Promise.all([
      // Non-mutation types: distinct samples per (study, alteration_type, datatype, assay_subtype)
      clickhouseClient.query({
        query: `
          SELECT
              gp.genetic_alteration_type,
              gp.datatype,
              gp.generic_assay_type AS assay_subtype,
              sum(distinct_samples) AS samples
          FROM (
              SELECT
                  gp.cancer_study_id,
                  gp.genetic_alteration_type,
                  gp.datatype,
                  gp.generic_assay_type,
                  length(arrayDistinct(arrayFlatten(groupArray(
                      splitByChar(',', assumeNotNull(gps.ordered_sample_list))
                  )))) AS distinct_samples
              FROM ${CH_DB}.genetic_profile gp
              JOIN ${CH_DB}.cancer_study cs ON gp.cancer_study_id = cs.cancer_study_id
              JOIN ${CH_DB}.genetic_profile_samples gps ON gp.genetic_profile_id = gps.genetic_profile_id
              WHERE ${YEAR_EXPR} = ${year}
                AND gp.genetic_alteration_type != 'MUTATION_EXTENDED'
              GROUP BY gp.cancer_study_id, gp.genetic_alteration_type, gp.datatype, gp.generic_assay_type
          ) gp
          GROUP BY gp.genetic_alteration_type, gp.datatype, gp.generic_assay_type
          ORDER BY samples DESC
        `,
        format: 'JSONEachRow',
      }),
      // Mutations via mutation table
      clickhouseClient.query({
        query: `
          SELECT count(DISTINCT m.sample_id) AS samples
          FROM ${CH_DB}.mutation m
          JOIN ${CH_DB}.genetic_profile gp ON m.genetic_profile_id = gp.genetic_profile_id
          JOIN ${CH_DB}.cancer_study cs ON gp.cancer_study_id = cs.cancer_study_id
          WHERE ${YEAR_EXPR} = ${year}
            AND gp.genetic_alteration_type = 'MUTATION_EXTENDED'
        `,
        format: 'JSONEachRow',
      }),
    ]);

    const nonMutRows = await nonMutResult.json();
    const mutRows = await mutResult.json();

    // Build human-readable display name from alteration_type + datatype + assay_subtype
    const buildDisplayName = (altType, datatype, assaySubtype) => {
      if (altType === 'MRNA_EXPRESSION') {
        if (datatype === 'Z-SCORE') return 'mRNA Expression (Z-score)';
        if (datatype === 'CONTINUOUS') return 'mRNA Expression';
        if (datatype === 'DISCRETE') return 'mRNA Expression (Discrete)';
        return `mRNA Expression (${datatype})`;
      }
      if (altType === 'COPY_NUMBER_ALTERATION') {
        if (datatype === 'DISCRETE') return 'Copy Number (Discrete)';
        if (datatype === 'LOG2-VALUE') return 'Copy Number (Log2)';
        if (datatype === 'CONTINUOUS') return 'Copy Number (Continuous)';
        return `Copy Number (${datatype})`;
      }
      if (altType === 'STRUCTURAL_VARIANT') return 'Structural Variants';
      if (altType === 'METHYLATION') return 'Methylation';
      if (altType === 'PROTEIN_LEVEL') {
        if (datatype === 'Z-SCORE') return 'Protein Level (Z-score)';
        if (datatype === 'LOG2-VALUE') return 'Protein Level (Log2)';
        return `Protein Level (${datatype})`;
      }
      if (altType === 'GENERIC_ASSAY') {
        const subtypeNames = {
          ARMLEVEL_CNA: 'Arm-level CNA',
          METHYLATION: 'Methylation (GENERIC)',
          GENETIC_ANCESTRY: 'Genetic Ancestry',
          MUTATIONAL_SIGNATURE: 'Mutational Signatures',
          GENE_EXPRESSION_SIGNATURE: 'Gene Expr. Signature',
          PHOSPHOSITE_QUANTIFICATION: 'Phosphoprotein',
          Phosphoproteome: 'Phosphoproteome',
          Acetylproteome: 'Acetylproteome',
          RELATIVE_COUNTS: 'Relative Cell Counts',
          ABSOLUTE_COUNTS: 'Absolute Cell Counts',
          TREATMENT_RESPONSE: 'Treatment Response',
          circular_rna: 'Circular RNA',
          Lipidome: 'Lipidome',
        };
        return subtypeNames[assaySubtype] || assaySubtype || 'Generic Assay';
      }
      return altType;
    };

    const nonMutData = nonMutRows.map(row => ({
      name: buildDisplayName(row.genetic_alteration_type, row.datatype, row.assay_subtype),
      count: Number(row.samples),
    }));

    const mutSamples = mutRows[0] ? Number(mutRows[0].samples) : 0;
    const mutData = mutSamples > 0 ? [{ name: 'Mutations', count: mutSamples }] : [];

    const data = [...nonMutData, ...mutData].sort((a, b) => b.count - a.count);

    res.json({ status: 'success', year, data });
  } catch (error) {
    console.error('ClickHouse sample counts by datatype error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch sample counts by data type' });
  }
});

/**
 * GET /api/analytics/news-releases
 */
router.get('/news-releases', async (req, res) => {
  try {
    const response = await fetch('https://docs.cbioportal.org/news/');
    if (!response.ok) throw new Error(`Failed to fetch news page: ${response.status}`);
    const html = await response.text();

    // Each release on the news page is delimited by an <h2 id="...">Month DD, YYYY</h2>
    // header. Split on those headers and treat the text between consecutive headers as
    // one release section. Non-data releases (e.g. feature announcements, version notes)
    // are skipped so the chart always shows the latest actual data release.
    const headerRegex = /<h2[^>]*>([^<]*\d{4}[^<]*)<\/h2>/g;
    const headers = [...html.matchAll(headerRegex)];
    const releases = [];

    headers.forEach((header, i) => {
      const date = header[1].trim();
      const start = header.index + header[0].length;
      const end = i + 1 < headers.length ? headers[i + 1].index : html.length;
      const section = html.slice(start, end);

      const dataMatch = section.match(/Added data.*?consisting of ([\d,]+) samples from (\d+)/i);
      if (!dataMatch) return;

      const studyList = [];
      const studyRegex = /<a href="(https:\/\/www\.cbioportal\.org\/study[^"]*)">([^<]+)<\/a>\s*<em>([\d,]+ samples?)<\/em>/g;
      let m;
      while ((m = studyRegex.exec(section)) !== null) {
        studyList.push({
          name: m[2].trim().replace(/&#x27;/g, "'").replace(/&amp;/g, '&'),
          url: m[1].trim(),
          samples: m[3].trim(),
        });
      }

      releases.push({
        date,
        samples: parseInt(dataMatch[1].replace(/,/g, '')),
        studies: parseInt(dataMatch[2]),
        studyList,
      });
    });

    const limit = parseInt(req.query.limit) || 10;
    res.json({
      status: 'success',
      latest: releases[0] || null,
      releases: releases.slice(0, limit),
    });
  } catch (error) {
    console.error('News releases scrape error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch news releases' });
  }
});

// ─── Submission Analytics Helpers ───────────────────────────────────────────

// Load all submissions from Postgres
async function loadAllSubmissions() {
  return listSubmissions();
}

// Map raw status to the 7-step pipeline stage
const PIPELINE_STAGES = [
  'Submitted',
  'Initial Review',
  'Approved for Portal',
  'Curation in Progress',
  'Final Review',
  'Preparing for Release',
  'Released',
];

function normalizeStatus(raw) {
  const s = (raw || '').trim();
  if (!s || s === 'pending' || s === 'received' || s === 'Awaiting Review') return 'Submitted';
  if (s === 'Approved for Portal Curation') return 'Approved for Portal';
  if (['Clarification Needed', 'Changes Requested', "Awaiting Submitter's Response",
       'Awaiting Submitters Response', 'In Progress', 'in-progress'].includes(s)) return 'Curation in Progress';
  if (s === 'Import in Progress') return 'Preparing for Release';
  if (s === 'Under Review' || s === 'in-review') return 'Final Review';
  if (s === 'In Portal' || s === 'approved') return 'Released';
  if (s === 'Missing Data' || s === 'needs-revision') return 'Not Curatable';
  if (s === 'rejected' || s === 'on-hold') return 'Not Curatable';
  return PIPELINE_STAGES.includes(s) ? s : 'Submitted';
}

/**
 * GET /api/analytics/submissions/pipeline-funnel
 * Counts submissions at each pipeline stage (funnel chart)
 */
router.get('/submissions/pipeline-funnel', async (req, res) => {
  try {
    const submissions = await loadAllSubmissions();
    const counts = {};
    PIPELINE_STAGES.forEach(s => { counts[s] = 0; });
    counts['Not Curatable'] = 0;

    submissions.forEach(sub => {
      const stage = normalizeStatus(sub.displayStatus || sub.status);
      counts[stage] = (counts[stage] || 0) + 1;
    });

    // Return as ordered funnel stages + not curatable at end
    const data = [
      ...PIPELINE_STAGES.map((stage, i) => ({
        stage,
        step: i + 1,
        count: counts[stage],
      })),
      { stage: 'Not Curatable', step: null, count: counts['Not Curatable'] },
    ].filter(d => d.count > 0);

    res.json({ status: 'success', data });
  } catch (error) {
    console.error('Pipeline funnel error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch pipeline funnel' });
  }
});

/**
 * GET /api/analytics/submissions/volume-over-time
 * Monthly submission counts split by track type
 */
router.get('/submissions/volume-over-time', async (req, res) => {
  try {
    const submissions = await loadAllSubmissions();
    const monthly = {};

    submissions.forEach(sub => {
      const date = new Date(sub.submittedAt || sub.createdAt);
      if (isNaN(date)) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthly[key]) monthly[key] = { month: key, 'Study Suggestion': 0, 'Data Submission': 0, total: 0 };
      const track = sub.submissionType === 'submit-data' ? 'Data Submission' : 'Study Suggestion';
      monthly[key][track]++;
      monthly[key].total++;
    });

    const data = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
    res.json({ status: 'success', data });
  } catch (error) {
    console.error('Volume over time error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch submission volume' });
  }
});

/**
 * GET /api/analytics/submissions/avg-time-per-stage
 * Average days spent in each stage using statusUpdatedAt vs submittedAt
 */
router.get('/submissions/avg-time-per-stage', async (req, res) => {
  try {
    const submissions = await loadAllSubmissions();

    // For each submission, calculate days from submission to status update
    // and assign to current stage
    const stageDays = {};
    PIPELINE_STAGES.forEach(s => { stageDays[s] = []; });

    submissions.forEach(sub => {
      const stage = normalizeStatus(sub.displayStatus || sub.status);
      if (!PIPELINE_STAGES.includes(stage)) return;
      const start = new Date(sub.submittedAt || sub.createdAt);
      const end = new Date(sub.statusUpdatedAt || sub.updatedAt || Date.now());
      if (isNaN(start) || isNaN(end)) return;
      const days = Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
      stageDays[stage].push(days);
    });

    const data = PIPELINE_STAGES
      .map(stage => ({
        stage,
        avgDays: stageDays[stage].length > 0
          ? Math.round(stageDays[stage].reduce((a, b) => a + b, 0) / stageDays[stage].length)
          : 0,
        count: stageDays[stage].length,
      }))
      .filter(d => d.count > 0);

    res.json({ status: 'success', data });
  } catch (error) {
    console.error('Avg time per stage error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch avg time per stage' });
  }
});

/**
 * GET /api/analytics/submissions/mix
 * Composition of submissions across three categorical dimensions:
 * submission type, publication type, and sharing preference.
 */
router.get('/submissions/mix', async (req, res) => {
  try {
    const submissions = await loadAllSubmissions();

    const tally = (items) => {
      const counts = {};
      items.forEach(({ key, label }) => {
        if (!key) return;
        counts[key] = counts[key] || { name: label, count: 0 };
        counts[key].count++;
      });
      return Object.values(counts);
    };

    const byType = tally(submissions.map(s => ({
      key: s.submissionType,
      label: s.submissionType === 'submit-data' ? 'Data Submission' : 'Study Suggestion',
    })));

    const byPublication = tally(submissions.map(s => ({
      key: s.publicationType,
      label: s.publicationType === 'published' ? 'Published'
        : s.publicationType === 'preprint' ? 'Pre-publication' : null,
    })));

    const bySharing = tally(submissions.map(s => ({
      key: s.sharingPreference,
      label: s.sharingPreference === 'public' ? 'Public'
        : s.sharingPreference === 'private' ? 'Private' : null,
    })));

    res.json({
      status: 'success',
      data: {
        total: submissions.length,
        byType,
        byPublication,
        bySharing,
      },
    });
  } catch (error) {
    console.error('Submission mix error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch submission mix' });
  }
});

export default router;
