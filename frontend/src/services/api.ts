
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

/**
 * Generic API fetch helper
 */
const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;

  const isFormData = options.body instanceof FormData;

  const headers: HeadersInit = {};

  // Only set Content-Type for non-FormData requests
  if (!isFormData) {
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
 * Submit content form data to backend
 * New unified endpoint that handles all submission types.
 * Data is shared by the submitter via an external link (no file uploads).
 */
export const submitContent = async (formData: any, skipDuplicateCheck?: boolean) => {
  const token = localStorage.getItem('authToken');

  if (!token) {
    throw new Error('Authentication required. Please log in.');
  }

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
  const token = localStorage.getItem('authToken');
  
  if (!token) {
    throw new Error('Authentication required. Please log in.');
  }
  
  return fetchApi('/api/submit', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
};

/**
 * Get a specific submission by ID
 */
export const getSubmission = async (id: string) => {
  const token = localStorage.getItem('authToken');
  
  if (!token) {
    throw new Error('Authentication required. Please log in.');
  }
  
  return fetchApi(`/api/submit/${id}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
};

/**
 * Update curation notes (super users only)
 */
export const updateCurationNotes = async (
  id: string,
  curationNotes: string,
  action: 'append' | 'edit' | 'delete' = 'append',
  noteIndex?: number
) => {
  const token = localStorage.getItem('authToken');
  if (!token) throw new Error('Authentication required. Please log in.');
  return fetchApi(`/api/submit/${id}/curation-notes`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ curationNotes, action, noteIndex })
  });
};

/**
 * Update submission status (super users only)
 */
export const updateSubmissionStatus = async (id: string, status: string, displayStatus?: string) => {
  const token = localStorage.getItem('authToken');
  
  if (!token) {
    throw new Error('Authentication required. Please log in.');
  }
  
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
 * Add a note to an existing submission (owner only)
 */
export const addNoteToSubmission = async (id: string, note: string) => {
  const token = localStorage.getItem('authToken');
  if (!token) throw new Error('Authentication required. Please log in.');

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
  const response = await fetch(`${API_URL}/api/submit/${id}/add-note`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ note }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to add note');
  }
  return response.json();
};

/**
 * Delete a submission
 */
export const deleteSubmission = async (id: string) => {
  const token = localStorage.getItem('authToken');
  
  if (!token) {
    throw new Error('Authentication required. Please log in.');
  }
  
  return fetchApi(`/api/submit/${id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
};
