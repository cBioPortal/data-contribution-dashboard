import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import SharedLayout from "@/components/SharedLayout";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search } from "lucide-react";
import { SubmissionGrid } from "@/components/track-status/SubmissionGrid";
import { usePaperColumnDefs, useDataColumnDefs, usePreprintDataColumnDefs, useMySubmissionsColumnDefs } from "@/components/track-status/GridConfig";
import { SubmissionProgressKey } from "@/components/track-status/SubmissionProgressKey";
import { logger } from "@/utils/logger";
import { getMySubmissions, getPublicSubmissions } from "@/services/api";
import { Submission } from "@/types/submission";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

const TrackStatus = () => {
  logger.debug("TrackStatus component rendering");
  
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const highlightParam = searchParams.get("highlight");
  const [activeTab, setActiveTab] = useState<'suggested-papers' | 'submitted-data' | 'my-submissions'>("suggested-papers");
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [isSuperUser, setIsSuperUser] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dataError, setDataError] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  
  const paperColumnDefs = usePaperColumnDefs(isSuperUser);
  const dataColumnDefs = useDataColumnDefs(isSuperUser);
  const preprintDataColumnDefs = usePreprintDataColumnDefs(isSuperUser);
  const mySubmissionsColumnDefs = useMySubmissionsColumnDefs(isSuperUser);

  // Fetch user profile (role + email) — runs independently so isSuperUser is set before grid renders
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
    fetch(`${API_URL}/api/auth/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => {
        if (d.status === 'success') {
          setUserEmail(d.data.user.email);
          setIsSuperUser(d.data.user.role === 'super');
        }
      })
      .catch(() => logger.warn('Could not fetch user profile'));
  }, []);

  // Load submissions from backend
  useEffect(() => {
    const loadSubmissions = async () => {
      try {
        setIsLoading(true);
        setDataError(false);
        
        // Check if user is logged in
        const token = localStorage.getItem('authToken');
        setIsLoggedIn(!!token);

        logger.debug("Fetching submissions from API");

        // Determine role directly — don't rely on isSuperUser state (race condition)
        let isSuper = false;
        let tokenIsValid = !!token;
        if (token) {
          const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
          try {
            const profileRes = await fetch(`${API_URL}/api/auth/profile`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (profileRes.status === 401) {
              // Token is invalid or user not found — clear it and fall back to public
              localStorage.removeItem('authToken');
              tokenIsValid = false;
              setIsLoggedIn(false);
              logger.warn('Auth token invalid, falling back to public view');
            } else {
              const profileData = await profileRes.json();
              if (profileData.status === 'success') {
                isSuper = profileData.data.user.role === 'super';
              }
            }
          } catch {
            // Network error — keep token but fall back to public for this load
            tokenIsValid = false;
          }
        }

        // Super users see all; regular users merge own + public; guests get public only
        let allSubmissions: any[] = [];
        if (!tokenIsValid) {
          const res = await getPublicSubmissions();
          allSubmissions = res.data.submissions;
        } else if (isSuper) {
          const res = await getMySubmissions();
          allSubmissions = res.data.submissions;
        } else {
          const [myRes, publicRes] = await Promise.all([getMySubmissions(), getPublicSubmissions()]);
          const seen = new Set<string>();
          for (const sub of [...myRes.data.submissions, ...publicRes.data.submissions]) {
            if (!seen.has(sub.id)) { seen.add(sub.id); allSubmissions.push(sub); }
          }
        }
        const response = { data: { submissions: allSubmissions } };
        logger.log("Successfully fetched", response.data.submissions.length, "submissions");
        
        // Transform backend submissions to match expected format
        const transformedSubmissions = response.data.submissions.map((sub: any) => ({
          submissionId: sub.id,
          status: sub.displayStatus || mapBackendStatus(sub.status),
          title: sub.submissionType === 'suggest-paper' ? sub.paperTitle : (sub.studyName || sub.paperTitle),
          author: sub.submitterName,
          createdAt: sub.submittedAt,
          submissionType: sub.submissionType,
          publicationType: sub.publicationType,
          // Contact
          email: sub.submitterEmail,
          alternativeEmail: sub.alternativeEmail,
          canContactEmail: sub.canContactEmail,
          // Study suggestion fields
          pmid: sub.pmid,
          paperTitle: sub.paperTitle,
          journal: sub.journal,
          authors: sub.authors,
          publicationYear: sub.publicationYear,
          isLeadAuthor: sub.isLeadAuthor,
          wantsToHelpCurate: sub.wantsToHelpCurate,
          // Data submission fields
          studyName: sub.studyName,
          studyDescription: sub.description,
          curatedDataLink: sub.linkToData,
          accessGranted: sub.accessGranted === true,
          isDataTransformed: sub.isDataTransformed,
          referenceGenome: sub.referenceGenome,
          associatedPaper: sub.associatedPaper,
          // Pre-publication
          sharingPreference: sub.sharingPreference,
          privateAccessEmails: sub.privateAccessEmails,
          // Common
          dataTypes: sub.dataTypes?.length > 0 ? sub.dataTypes.join(', ') : null,
          notes: sub.notes,
          supersededBy: sub.supersededBy || null,
          supersededAt: sub.supersededAt || null,
          curationNotes: sub.curationNotes || '',
          curationNotesArray: sub.curationNotesArray || [],
          curationNotesUpdatedAt: sub.curationNotesUpdatedAt || null,
          submitterNotes: sub.submitterNotes || [],
        }));
        
        setSubmissions(transformedSubmissions);
        setDataError(false);
      } catch (error: any) {
        logger.error("Error fetching submissions:", error);
        
        // More specific error messages
        if (error.message?.includes('Failed to fetch') || error.message?.includes('Network')) {
          toast.error("Cannot connect to server. Please check if the backend is running.");
          setDataError(true);
        } else if (error.message?.includes('429') || error.message?.includes('Too many')) {
          toast.error("Too many requests — please wait a moment and refresh.");
          // Don't show the full error screen for rate limiting, just show empty state
        } else {
          toast.error(`Failed to load submissions: ${error.message}`);
          setDataError(true);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadSubmissions();
  }, []);

  // Helper function to map backend status to frontend display status
  const mapBackendStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
      'pending': 'Submitted',
      'received': 'Awaiting Review',
      'in-progress': 'Curation in Progress',
      'in-review': 'In Review',
      'missing-data': 'Missing Data',
      'not-curatable': 'Not Curatable',
      'in-portal': 'In Portal',
      'approved': 'Released',
      'rejected': 'Not Curatable'
    };
    return statusMap[status] || 'Submission';
  };

  // Handle tab parameter from URL
  useEffect(() => {
    if (tabParam && (tabParam === "suggested-papers" || tabParam === "submitted-data" || tabParam === "my-submissions")) {
      setActiveTab(tabParam as 'suggested-papers' | 'submitted-data' | 'my-submissions');
    }
  }, [tabParam]);

  // Handle highlight parameter — auto-search for the submission ID
  useEffect(() => {
    if (highlightParam) {
      setSearchQuery(highlightParam);
    }
  }, [highlightParam]);

  // Separate submissions by type and publication status
  const { publishedPapers, preprintPapers } = useMemo(() => {
    const papers = submissions.filter(sub => sub.submissionType === 'suggest-paper');
    return {
      publishedPapers: papers.filter(sub => sub.publicationType === 'published'),
      preprintPapers: papers.filter(sub => sub.publicationType === 'preprint')
    };
  }, [submissions]);

  const { publishedData, preprintData } = useMemo(() => {
    const data = submissions.filter(sub => sub.submissionType === 'submit-data');
    return {
      publishedData: data.filter(sub => sub.publicationType === 'published'),
      // Pre-publication submissions (public or private) are only visible to super
      // users and the user who submitted them. The backend already restricts which
      // preprints reach this client (own submissions for regular users, all for
      // super users), so every preprint present here is one the user may see.
      preprintData: data.filter(sub => sub.publicationType === 'preprint')
    };
  }, [submissions]);

  // My submissions — filtered by form email if provided, otherwise login email
  const mySubmissions = useMemo(() => {
    if (!userEmail) return submissions;
    return submissions.filter(sub => {
      const formEmail = sub.email?.toLowerCase().trim();
      const loginEmail = userEmail.toLowerCase().trim();
      // Use form email as the identity if it was filled in, else fall back to login email
      return formEmail ? formEmail === loginEmail : true;
    });
  }, [submissions, userEmail]);

  // Search across all meaningful fields
  const matchesQuery = (submission: Submission, query: string): boolean => {
    if (!query) return true;
    const fields = [
      submission.title,
      submission.status,
      submission.author,
      submission.email,
      submission.pmid,
      submission.studyName,
      submission.studyDescription,
      submission.journal,
      submission.submissionId?.replace(/^submission_/, ''),
      submission.dataTypes,
      submission.notes,
      submission.referenceGenome,
      submission.associatedPaper,
    ];
    return fields.some(f => f?.toLowerCase().includes(query));
  };

  // Filter submissions based on search query and active tab
  const filteredPaperSubmissions = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const paperData = activeTab === 'suggested-papers' ? publishedPapers : preprintPapers;
    return paperData.filter(s => matchesQuery(s, query));
  }, [publishedPapers, preprintPapers, activeTab, searchQuery]);

  const filteredDataSubmissions = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const dataSubmissions = activeTab === 'suggested-papers' ? publishedData : preprintData;
    return dataSubmissions.filter(s => matchesQuery(s, query));
  }, [publishedData, preprintData, activeTab, searchQuery]);

  // Update submissions state when a status is assigned — keeps labels persistent across tab switches
  const handleStatusChanged = (submissionId: string, newStatus: string) => {
    setSubmissions(prev => prev.map(s =>
      (s.submissionId === submissionId || s.id === submissionId)
        ? { ...s, status: newStatus }
        : s
    ));
  };

  // Remove deleted submission from local state immediately
  const handleDeleted = (submissionId: string) => {
    setSubmissions(prev => prev.filter(s =>
      s.submissionId !== submissionId && s.id !== submissionId
    ));
  };

  const filteredMySubmissions = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return mySubmissions.filter(s => matchesQuery(s, query));
  }, [mySubmissions, searchQuery]);

  logger.debug("Active tab:", activeTab);
  logger.debug("Total submissions:", submissions.length);
  logger.debug("Filtered paper submissions:", filteredPaperSubmissions.length);
  logger.debug("Filtered data submissions:", filteredDataSubmissions.length);
  logger.debug("Is loading:", isLoading);

  // Show loading state
  if (isLoading) {
    return (
      <SharedLayout>
        <div className="min-h-screen bg-gradient-to-b from-blue-50/50 to-white py-12">
          <div className="w-full px-4 sm:px-6">
            <div className="bg-white rounded-lg shadow-md p-12 text-center max-w-2xl mx-auto">
              <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-500 border-r-transparent mb-4"></div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">Loading your submissions...</h2>
              <p className="text-gray-600">Please wait while we fetch your data.</p>
            </div>
          </div>
        </div>
      </SharedLayout>
    );
  }

  // Show error state if data failed to load
  if (dataError) {
    return (
      <SharedLayout>
        <div className="min-h-screen bg-gradient-to-b from-blue-50/50 to-white py-12">
          <div className="w-full px-4 sm:px-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center max-w-2xl mx-auto">
              <h2 className="text-2xl font-bold text-red-800 mb-2">Unable to Load Submission Data</h2>
              <p className="text-red-600 mb-4">There was an error loading the submission data. Please try again.</p>
              <button
                onClick={() => window.location.reload()}
                className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      </SharedLayout>
    );
  }

  return (
    <SharedLayout>
      <div className="min-h-screen bg-gradient-to-b from-blue-50/50 to-white py-12">
        <div className="w-full px-4 sm:px-6">
          <div className="mb-8 text-center">
            <div className="inline-flex items-center justify-center p-2 mb-4 bg-blue-100 rounded-full">
              <Search className="h-8 w-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold mb-3 text-gray-800">Track Submission Status</h1>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              Track the status of your submissions in real-time and view papers or datasets in the curation pipeline.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-gray-100">
            <div className="p-6 md:p-8 w-full">
              {/* Submission Type Selection and Search Bar on same line */}
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                <Tabs
                  value={activeTab}
                  onValueChange={(value) => {
                    setActiveTab(value as 'suggested-papers' | 'submitted-data' | 'my-submissions');
                    logger.debug("Tab changed to:", value);
                  }}
                  className="w-full lg:w-auto"
                >
                  <TabsList className={`grid w-full lg:w-auto lg:inline-grid ${isLoggedIn ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <TabsTrigger value="suggested-papers" className="text-base font-semibold">
                      Published ({publishedPapers.length + publishedData.length})
                    </TabsTrigger>
                    <TabsTrigger value="submitted-data" className="text-base font-semibold">
                      Pre-publication ({preprintData.length})
                    </TabsTrigger>
                    {isLoggedIn && (
                      <TabsTrigger value="my-submissions" className="text-base font-semibold">
                        My Submissions ({mySubmissions.length})
                      </TabsTrigger>
                    )}
                  </TabsList>
                </Tabs>
                
                {/* Search Bar */}
                <div className="flex items-center space-x-2 p-2 rounded-lg border-2 border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 transition-all w-full lg:w-1/5">
                  <Search className="h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    className="border-0 bg-transparent p-0 text-sm font-medium text-gray-700 placeholder:text-gray-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      logger.debug("Search query:", e.target.value);
                    }}
                  />
                </div>
              </div>
              
              {/* Add the Submission Progress Key — hidden on My Submissions tab */}
              {activeTab !== 'my-submissions' && (
                <SubmissionProgressKey trackType={activeTab as 'suggested-papers' | 'submitted-data'} />
              )}
              
              {/* Content based on active tab */}
              {activeTab === "suggested-papers" && (
                <div>
                  {filteredPaperSubmissions.length === 0 && filteredDataSubmissions.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-gray-500 text-lg">No published submissions found.</p>
                      <p className="text-gray-400 text-sm mt-2">Submit your first paper or dataset to see it here!</p>
                    </div>
                  ) : (
                    <>
                      {filteredPaperSubmissions.length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-lg font-semibold text-gray-700 mb-3">Study Suggestions</h3>
                          <SubmissionGrid 
                            key={`pub-papers-${isSuperUser}`}
                            rowData={filteredPaperSubmissions} 
                            columnDefs={paperColumnDefs}
                            trackType="suggested-papers"
                            isSuperUser={isSuperUser}
                            currentUserEmail={userEmail}
                            onStatusChanged={handleStatusChanged}
                            onDeleted={handleDeleted}
                          />
                        </div>
                      )}
                      {filteredDataSubmissions.length > 0 && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-700 mb-3">Data Submissions</h3>
                          <SubmissionGrid 
                            key={`pub-data-${isSuperUser}`}
                            rowData={filteredDataSubmissions} 
                            columnDefs={dataColumnDefs}
                            trackType="submitted-data"
                            isSuperUser={isSuperUser}
                            currentUserEmail={userEmail}
                            onStatusChanged={handleStatusChanged}
                            onDeleted={handleDeleted}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {activeTab === "submitted-data" && (
                <div>
                  {filteredPaperSubmissions.length === 0 && filteredDataSubmissions.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-gray-500 text-lg">No pre-publication submissions found.</p>
                      <p className="text-gray-400 text-sm mt-2">
                        {isLoggedIn ? 'Submit your first preprint or dataset to see it here!' : 'Pre-publication submissions are only visible to the user who submitted them and super users. Please log in to see yours.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Public Data Submissions */}
                      {filteredDataSubmissions.filter(s => s.sharingPreference === 'public').length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-lg font-semibold text-gray-700 mb-3">Public Data Submissions</h3>
                          <SubmissionGrid
                            key={`pre-data-public-${isSuperUser}`}
                            rowData={filteredDataSubmissions.filter(s => s.sharingPreference === 'public')}
                            columnDefs={preprintDataColumnDefs}
                            trackType="submitted-data"
                            isSuperUser={isSuperUser}
                            currentUserEmail={userEmail}
                            onStatusChanged={handleStatusChanged}
                            onDeleted={handleDeleted}
                          />
                        </div>
                      )}
                      {/* Private Data Submissions — shown to super users and the submitter */}
                      {filteredDataSubmissions.filter(s => s.sharingPreference === 'private').length > 0 && (
                        <div>
                          <h3 className="text-lg font-semibold text-gray-700 mb-3">Private Data Submissions</h3>
                          <SubmissionGrid
                            key={`pre-data-private-${isSuperUser}`}
                            rowData={filteredDataSubmissions.filter(s => s.sharingPreference === 'private')}
                            columnDefs={preprintDataColumnDefs}
                            trackType="submitted-data"
                            isSuperUser={isSuperUser}
                            currentUserEmail={userEmail}
                            onStatusChanged={handleStatusChanged}
                            onDeleted={handleDeleted}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeTab === "my-submissions" && isLoggedIn && (
                <div>
                  {/* User identity banner */}
                  {userEmail && (
                    <div className="flex items-center gap-2 mb-4 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                      <span>Showing submissions for <span className="font-medium text-gray-700">{userEmail}</span></span>
                      <span className="text-gray-400 text-xs ml-1">(form email if provided, otherwise login email)</span>
                    </div>
                  )}

                  {/* Single progress key — prefer whichever track the user has more submissions in */}
                  {(() => {
                    const paperCount = filteredMySubmissions.filter(s => s.submissionType === 'suggest-paper').length;
                    const dataCount = filteredMySubmissions.filter(s => s.submissionType === 'submit-data').length;
                    const trackType = dataCount > paperCount ? 'submitted-data' : 'suggested-papers';
                    return (paperCount > 0 || dataCount > 0) ? <SubmissionProgressKey trackType={trackType} /> : null;
                  })()}

                  {filteredMySubmissions.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-gray-500 text-lg">No submissions found.</p>
                      <p className="text-gray-400 text-sm mt-2">Your submitted papers and datasets will appear here.</p>
                    </div>
                  ) : (
                    <SubmissionGrid
                      key={`my-${isSuperUser}`}
                      rowData={filteredMySubmissions}
                      columnDefs={mySubmissionsColumnDefs}
                      trackType="suggested-papers"
                      isSuperUser={false}
                      currentUserEmail={userEmail}
                      onStatusChanged={handleStatusChanged}
                      onDeleted={handleDeleted}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </SharedLayout>
  );
};

export default TrackStatus;