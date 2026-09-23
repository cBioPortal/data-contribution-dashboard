import type { Submission } from '@/types/submission';

const OPEN_VOLUNTEER_STAGES = new Set([
  'Submitted',
  'Submission',
  'Awaiting Review',
  'Received',
  'Initial Review',
  'Pending Review',
  'Approved for Curation',
  'Approved for Portal',
  'Approved for Portal Curation',
]);

export const isCommunityVolunteerStudy = (submission: Partial<Submission>) =>
  submission.submissionType === 'suggest-paper' &&
  submission.publicationType === 'published';

export const isVolunteerSignupOpen = (submission: Partial<Submission>) =>
  isCommunityVolunteerStudy(submission) &&
  OPEN_VOLUNTEER_STAGES.has(String(submission.status || '')) &&
  submission.curationInterestAccepted !== true;
