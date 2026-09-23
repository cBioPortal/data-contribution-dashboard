import { API_URL as API_BASE_URL } from "@/config";
import { ensureFreshToken } from '@/services/keycloak';

/**
 * Generic API fetch helper
 */
const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;

  const isFormData = options.body instanceof FormData;

  const headers: HeadersInit = {};

  // Only declare a JSON body when there actually is one. Setting Content-Type on
  // a bodyless GET makes it a non-simple cross-origin request, so the browser
  // inserts a preflight OPTIONS round trip ahead of every read — the reads on
  // this page are on the critical path, and none of them carry a body.
  // (FormData sets its own Content-Type, boundary included, so never override it.)
  if (options.body !== undefined && !isFormData) {
    headers["Content-Type"] = "application/json";
  }

  // Merge custom headers (this includes Authorization)
  const finalHeaders = {
    ...headers,
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers: finalHeaders,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `API error: ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

/**
 * Token for an authenticated request.
 *
 * Refreshes through Keycloak first, so a request issued after the user has spent
 * a while on a page still carries a live token. Access tokens are short-lived and
 * the submission form takes longer to fill in than one lasts. Falls back to the
 * mirrored copy only if Keycloak has not initialised yet.
 */
const requireToken = async (): Promise<string> => {
  const token = (await ensureFreshToken()) ?? localStorage.getItem('authToken');
  if (!token) {
    throw new Error('Your session has expired. Please log in again.');
  }
  return token;
};

/**
 * Submit content form data to backend
 * New unified endpoint that handles all submission types.
 * Data is shared by the submitter via an external link (no file uploads).
 */
export const submitContent = async (formData: any, skipDuplicateCheck?: boolean) => {
  const token = await requireToken();

  const response = await fetch(`${API_BASE_URL}/api/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: formData, skipDuplicateCheck: !!skipDuplicateCheck }),
  });

  // 409 = duplicate/conflict — throw a structured error the form can inspect
  if (response.status === 409) {
    const conflictData = await response.json().catch(() => ({}));
    const err: any = new Error(conflictData.message || 'Duplicate submission detected');
    err.isConflict = true;
    err.conflictType = conflictData.conflictType;
    err.existingSubmissionId = conflictData.existingSubmissionId;
    err.existingSubmissionType = conflictData.existingSubmissionType;
    err.existingTitle = conflictData.existingTitle;
    err.existingStatus = conflictData.existingStatus;
    err.similarityScore = conflictData.similarityScore;
    throw err;
  }
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `API error: ${response.status}`);
  }
  
  return response.json();
};

/**
 * Submit paper suggestion to backend
 * @deprecated Use submitContent instead
 */
export const submitPaperSuggestion = async (data: any) => {
  return submitContent(data);
};

/**
 * Submit curated data to backend
 * @deprecated Use submitContent instead
 */
export const submitCuratedData = async (data: any) => {
  return submitContent(data);
};

// ─── Questions ───────────────────────────────────────────────────────────────

/** Question threads on a submission that this caller may read. */
export const getQuestions = async (submissionId: string) => {
  const token = await ensureFreshToken().catch(() => null);

  return fetchApi(`/api/submit/${submissionId}/questions`, {
    method: 'GET',
    // Sent when we have one — it is what reveals private threads and enables the
    // composer — but reading public questions needs no session.
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
};

/** Open a thread. `private` is refused server-side for anyone but the submitter. */
export const askQuestion = async (
  submissionId: string,
  question: { body: string; visibility: 'public' | 'private' },
) => {
  const token = await requireToken();

  return fetchApi(`/api/submit/${submissionId}/questions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(question),
  });
};

/** Reply to a thread. */
export const replyToQuestion = async (submissionId: string, threadId: string, body: string) => {
  const token = await requireToken();

  return fetchApi(`/api/submit/${submissionId}/questions/${threadId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ body }),
  });
};

/** Retract a message. Its author, or the curation team. */
export const retractQuestionMessage = async (
  submissionId: string, threadId: string, messageId: string,
) => {
  const token = await requireToken();

  return fetchApi(`/api/submit/${submissionId}/questions/${threadId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
};

// ─── Community curation volunteers ──────────────────────────────────────────

export const getCurationVolunteers = async (submissionId: string) => {
  const token = await ensureFreshToken().catch(() => null);
  return fetchApi(`/api/submit/${submissionId}/curation-volunteers`, {
    method: 'GET',
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
};

export const registerCurationVolunteer = async (
  submissionId: string,
  application: {
    name: string;
    email: string;
    designation: string;
    currentWork: string;
    publicNameConsent: boolean;
  },
) => {
  const token = await requireToken();
  return fetchApi(`/api/submit/${submissionId}/curation-volunteers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(application),
  });
};

export const withdrawCurationVolunteer = async (submissionId: string) => {
  const token = await requireToken();
  return fetchApi(`/api/submit/${submissionId}/curation-volunteers/me`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
};

export const reviewCurationInterest = async (
  submissionId: string,
  volunteerId: string,
  status: 'pending' | 'accepted' | 'completed' | 'declined',
) => {
  const token = await requireToken();
  return fetchApi(`/api/submit/${submissionId}/curation-volunteers/${volunteerId}`, {
    method: 'PATCH',
    headers: { 'Authorization': ['Bearer', token].join(' ') },
    body: JSON.stringify({ status }),
  });
};

export const requestCurationReview = async (submissionId: string) => {
  const token = await requireToken();
  return fetchApi(`/api/submit/${submissionId}/curation-volunteers/me/review-request`, {
    method: 'POST',
    headers: { 'Authorization': ['Bearer', token].join(' ') },
  });
};

export const requestCurationChanges = async (
  submissionId: string,
  volunteerId: string,
  feedback: string,
) => {
  const token = await requireToken();
  return fetchApi(`/api/submit/${submissionId}/curation-volunteers/${volunteerId}/request-changes`, {
    method: 'POST',
    headers: { 'Authorization': ['Bearer', token].join(' ') },
    body: JSON.stringify({ feedback }),
  });
};

// ─── Curation record ─────────────────────────────────────────────────────────
// The README and activity log for one submission. Fetched per submission rather
// than carried in the list payload, so a tracker showing 84 studies does not
// download every word ever written about them.

/**
 * The curation record. Readable without a session for published studies;
 * pre-publication records are restricted to the submitter and curation team.
 * Internal notes are returned to the curation team and assigned Community Curator.
 */
export const getCurationRecord = async (submissionId: string) => {
  const token = await ensureFreshToken().catch(() => null);

  return fetchApi(`/api/submit/${submissionId}/record`, {
    method: 'GET',
    // Sent when we have one — it is what upgrades the response from the public
    // view to the curator's — but its absence is not an error.
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
};

/** Replace a submission's README. Curation team or assigned Community Curator. */
export const saveCurationReadme = async (submissionId: string, sections: Record<string, string>) => {
  const token = await requireToken();

  return fetchApi(`/api/submit/${submissionId}/record/readme`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ sections }),
  });
};

export interface CurationDeliverables {
  workspaceUrl: string;
  validationReportUrl: string;
  version?: string;
  summary: string;
  dataTypes: string[];
  checklist: Record<string, boolean | undefined>;
  updatedAt?: string;
}

export const saveCurationDeliverables = async (
  submissionId: string,
  deliverables: Omit<CurationDeliverables, 'updatedAt'>,
) => {
  const token = await requireToken();
  return fetchApi(`/api/submit/${submissionId}/record/deliverables`, {
    method: 'PUT',
    headers: { 'Authorization': ['Bearer', token].join(' ') },
    body: JSON.stringify(deliverables),
  });
};

/** Append a note. The stage it belongs to is decided server-side. */
export const addCurationNote = async (
  submissionId: string,
  note: { body: string; kind?: string; visibility?: 'public' | 'internal' },
) => {
  const token = await requireToken();

  return fetchApi(`/api/submit/${submissionId}/record/notes`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(note),
  });
};

/** Rewrite a note's text. Community Curators may rewrite only their own. */
export const editCurationNote = async (submissionId: string, noteId: string, body: string) => {
  const token = await requireToken();

  return fetchApi(`/api/submit/${submissionId}/record/notes/${noteId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ body }),
  });
};

/** Retract a note. Community Curators may retract only their own. */
export const deleteCurationNote = async (submissionId: string, noteId: string) => {
  const token = await requireToken();

  return fetchApi(`/api/submit/${submissionId}/record/notes/${noteId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
};

/**
 * Resolve a PMID, DOI or article URL to publication metadata, and report whether
 * that paper has already been submitted.
 *
 * Authenticated: the endpoint is a proxy onto Europe PMC and Crossref, and its
 * only caller is the submit form, which already requires a session.
 */
export const lookupPublication = async (identifier: string) => {
  const token = await requireToken();

  return fetchApi(`/api/lookup?identifier=${encodeURIComponent(identifier)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
};

/**
 * Get public submissions (no auth required)
 * - All published submissions
 * - Pre-publication submissions with sharingPreference === 'public'
 */
export const getPublicSubmissions = async () => {
  return fetchApi('/api/submit/public', { method: 'GET' });
};

/**
 * Get all submissions for the current user
 */
export const getMySubmissions = async () => {
  const token = await requireToken();
  
  return fetchApi('/api/submit', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
};

export const upvoteStudy = async (submissionId: string) => {
  const token = await requireToken();

  return fetchApi(`/api/submit/${submissionId}/upvote`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
};

/**
 * Get a specific submission by ID
 */
export const getSubmission = async (id: string) => {
  const token = await requireToken();
  
  return fetchApi(`/api/submit/${id}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
};

/**
 * Update submission status (super users only)
 */
export const updateSubmissionStatus = async (id: string, status: string, displayStatus?: string) => {
  const token = await requireToken();
  
  return fetchApi(`/api/submit/${id}/status`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status, displayStatus })
  });
};

/**
 * Update editable overview metadata (super users only)
 */
export const updateSubmissionOverview = async (id: string, updates: Record<string, unknown>) => {
  const token = await requireToken();

  return fetchApi(`/api/submit/${id}/overview`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  });
};

/**
 * List current curation-team members (super users only)
 */
export const getCurationTeamMembers = async () => {
  const token = await requireToken();

  const response = await fetchApi('/api/users', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return {
    ...response,
    data: {
      ...response.data,
      users: (response.data?.users || []).filter((user: { role?: string }) => user.role === 'super')
    }
  };
};

/**
 * Delete a submission
 */
export const deleteSubmission = async (id: string) => {
  const token = await requireToken();
  
  return fetchApi(`/api/submit/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
};
