
export const suggestedPapersNormalFlow = [
  'Submitted',
  'Initial Review',
  'Approved for Portal',
  'Curation in Progress',
  'Final Review',
  'Preparing for Release',
  'Released'
];

export const suggestedPapersRejectedFlow = [
  'Submitted',
  'Initial Review',
  'Rejected'
];

export const submittedDataNormalFlow = [
  'Submitted',
  'Initial Review',
  'Approved for Portal',
  'Curation in Progress',
  'Final Review',
  'Preparing for Release',
  'Released'
];

export const submittedDataRejectedFlow = [
  'Submitted',
  'Initial Review',
  'Rejected'
];

export const stepDescriptions: Record<string, string> = {
  'Submitted': "Your submission has been received.",
  'Initial Review': 'We quickly check if the submission has enough data to move forward.',
  'Approved for Portal': 'Your submission is approved — curation work will begin soon.',
  'Curation in Progress': 'We are preparing and organizing your data for the portal.',
  'Final Review': 'We are doing a final internal check to ensure everything is accurate.',
  'Preparing for Release': 'We are getting ready to make your data public.',
  'Released': 'Your data is now live on the portal!',
  'Rejected': "We reviewed your submission, but unfortunately it doesn't have enough data to move forward at this time."
};

export const getMappedStatus = (status: string, trackType: 'suggested-papers' | 'submitted-data' = 'suggested-papers'): string => {
  // Map "Awaiting Review" to "Submitted"
  if (status === 'Awaiting Review') {
    return 'Submitted';
  }
  
  // Map curation-related statuses to "Curation in Progress"
  const curationStatuses = ['Clarification Needed', 'Changes Requested', 'Awaiting Submitters Response', 'Curation in Progress'];
  if (curationStatuses.includes(status)) {
    return 'Curation in Progress';
  }
  
  const preparingStatuses = ['Import in Progress'];
  if (preparingStatuses.includes(status)) {
    return 'Preparing for Release';
  }
  
  // Map "Submission" to "Submitted" for consistency
  if (status === 'Submission') {
    return 'Submitted';
  }
  
  // Map "Under Review" to Final Review on both tracks
  if (status === 'Under Review') {
    return 'Final Review';
  }

  // Map curation-related statuses
  if (["Awaiting Submitter's Response", 'Awaiting Submitters Response', 'Clarification Needed', 'Changes Requested', 'In Progress'].includes(status)) {
    return 'Curation in Progress';
  }

  // Map In Portal to Released
  if (status === 'In Portal') return 'Released';

  // Map Missing Data to Not Curatable
  if (status === 'Missing Data') return 'Not Curatable';
  
  // Map legacy "Approved for Portal Curation" to unified label
  if (status === 'Approved for Portal Curation') {
    return 'Approved for Portal';
  }
  
  return status;
};
