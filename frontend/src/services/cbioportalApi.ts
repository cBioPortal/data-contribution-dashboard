const CBIOPORTAL_API = "https://www.cbioportal.org/api";
const BACKEND_URL = () => import.meta.env.VITE_API_URL || 'http://localhost:5001';

// ─── cBioPortal public API ───────────────────────────────────────────────────

export const fetchCancerStudies = async () => {
  const r = await fetch(`${CBIOPORTAL_API}/studies?projection=SUMMARY`);
  if (!r.ok) throw new Error(`Failed to fetch cancer studies: ${r.status}`);
  return r.json();
};

export const fetchCancerTypes = async () => {
  const r = await fetch(`${CBIOPORTAL_API}/cancer-types`);
  if (!r.ok) throw new Error(`Failed to fetch cancer types: ${r.status}`);
  return r.json();
};

export const fetchStudiesCount = async (): Promise<number> => {
  const r = await fetch(`${CBIOPORTAL_API}/studies?projection=META`);
  if (!r.ok) throw new Error(`Failed to fetch studies count: ${r.status}`);
  return parseInt(r.headers.get('Total-Count') || '0', 10);
};

export const fetchSamples = async (): Promise<number> => {
  const r = await fetch(`${CBIOPORTAL_API}/samples?projection=META`);
  if (!r.ok) throw new Error(`Failed to fetch samples count: ${r.status}`);
  return parseInt(r.headers.get('Total-Count') || '0', 10);
};

export const fetchPatientsCount = async (): Promise<number> => {
  const r = await fetch(`${CBIOPORTAL_API}/patients?projection=META`);
  if (!r.ok) throw new Error(`Failed to fetch patients count: ${r.status}`);
  return parseInt(r.headers.get('Total-Count') || '0', 10);
};

// ─── Backend / ClickHouse ────────────────────────────────────────────────────

export const fetchStudySampleCounts = async (): Promise<Record<string, number>> => {
  try {
    const r = await fetch(`${BACKEND_URL()}/api/analytics/study-sample-counts`);
    if (!r.ok) throw new Error(`Failed to fetch study sample counts: ${r.status}`);
    return (await r.json()).data;
  } catch (error) {
    console.error('Error fetching study sample counts:', error);
    return {};
  }
};

export const fetchCancerTypeSamples = async (limit = 20): Promise<Array<{ cancerTypeId: string; name: string; samples: number; studies: number }>> => {
  try {
    const r = await fetch(`${BACKEND_URL()}/api/analytics/cancer-type-samples?limit=${limit}`);
    if (!r.ok) throw new Error(`Failed to fetch cancer type samples: ${r.status}`);
    return (await r.json()).data;
  } catch (error) {
    console.error('Error fetching cancer type samples:', error);
    throw error;
  }
};

export const fetchSampleCountsByDataType = async (year: number): Promise<Array<{ name: string; count: number }>> => {
  try {
    const r = await fetch(`${BACKEND_URL()}/api/analytics/sample-counts-by-datatype?year=${year}`);
    if (!r.ok) throw new Error(`Failed to fetch sample counts by data type: ${r.status}`);
    return (await r.json()).data;
  } catch (error) {
    console.error('Error fetching sample counts by data type:', error);
    return [];
  }
};

export const fetchCumulativeGrowth = async (): Promise<Array<{ year: number; studies: number; samples: number }>> => {
  try {
    const r = await fetch(`${BACKEND_URL()}/api/analytics/cumulative-growth`);
    if (!r.ok) throw new Error(`Failed to fetch cumulative growth: ${r.status}`);
    return (await r.json()).data;
  } catch (error) {
    console.error('Error fetching cumulative growth:', error);
    throw error;
  }
};

export const fetchNewsReleases = async () => {
  try {
    const r = await fetch(`${BACKEND_URL()}/api/analytics/news-releases`);
    if (!r.ok) throw new Error(`Failed to fetch news releases: ${r.status}`);
    const json = await r.json();
    return { latest: json.latest, releases: json.releases };
  } catch (error) {
    console.error('Error fetching news releases:', error);
    return { latest: null, releases: [] };
  }
};

export const fetchPipelineFunnel = async () => {
  const r = await fetch(`${BACKEND_URL()}/api/analytics/submissions/pipeline-funnel`);
  if (!r.ok) throw new Error('Failed to fetch pipeline funnel');
  return (await r.json()).data;
};

export const fetchSubmissionVolume = async () => {
  const r = await fetch(`${BACKEND_URL()}/api/analytics/submissions/volume-over-time`);
  if (!r.ok) throw new Error('Failed to fetch submission volume');
  return (await r.json()).data;
};

export interface SubmissionMix {
  total: number;
  byType: Array<{ name: string; count: number }>;
  byPublication: Array<{ name: string; count: number }>;
  bySharing: Array<{ name: string; count: number }>;
}

export const fetchSubmissionMix = async (): Promise<SubmissionMix> => {
  const r = await fetch(`${BACKEND_URL()}/api/analytics/submissions/mix`);
  if (!r.ok) throw new Error('Failed to fetch submission mix');
  return (await r.json()).data;
};

