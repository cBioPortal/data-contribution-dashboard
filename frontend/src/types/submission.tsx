import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

export interface Submission {
  submissionId?: string;
  issueNumber?: string;
  status: string;
  title?: string;
  author?: string;
  createdAt?: string;
  url?: string;
  isExpansionRow?: boolean;
  submissionType?: 'suggest-paper' | 'submit-data';
  publicationType?: 'published' | 'preprint';
  sharingPreference?: 'public' | 'private';
  // Legacy fields for backward compatibility
  id?: string;
  submissionDate?: string;
  submitterName?: string;
  email?: string;
  paper?: string;
  journal?: string;
  notes?: string;
  studyName?: string;
  studyDescription?: string;
  curatedDataLink?: string;
  curationNotes?: string;
  submitterNotes?: Array<{ text: string; addedAt: string; addedBy: string }>;
}

// Define status colors with the updated color palette
const statusColors: Record<string, string> = {
  "Submission": "bg-gray-200 text-gray-700",
  "Submitted": "bg-gray-200 text-gray-700",
  "Awaiting Review": "bg-gray-200 text-gray-700",
  "Received": "bg-gray-200 text-gray-700",
  "Initial Review": "bg-sky-200 text-sky-800",
  "Pending Review": "bg-sky-200 text-sky-800",
  "Approved for Portal Curation": "bg-green-200 text-green-800",
  "Approved for Portal": "bg-green-200 text-green-800",
  "Curation in Progress": "bg-yellow-200 text-yellow-800",
  "Clarification Needed": "bg-yellow-200 text-yellow-800",
  "Changes Requested": "bg-yellow-200 text-yellow-800",
  "Awaiting Submitter's Response": "bg-yellow-200 text-yellow-800",
  "In Progress": "bg-yellow-200 text-yellow-800",
  "Final Review": "bg-orange-200 text-orange-800",
  "In Review": "bg-orange-200 text-orange-800",
  "Under Review": "bg-orange-200 text-orange-800",
  "Preparing for Release": "bg-teal-200 text-teal-800",
  "Import in Progress": "bg-teal-200 text-teal-800",
  "Released": "bg-green-800 text-white",
  "In Portal": "bg-green-800 text-white",
  "Not Curatable": "bg-red-200 text-red-800",
  "Missing Data": "bg-red-200 text-red-800",
};

const statusDescriptions: Record<string, string> = {
  "Submission": "You've suggested the data.",
  "Awaiting Review": "We quickly check if the paper has enough data to move forward.",
  "In Review": "We are working to prepare and organize your data for the portal.",
  "Clarification Needed": "We are working to prepare and organize your data for the portal.",
  "Approved for Portal": "Your data is approved for curation into cBioPortal.",
  "Preparing for Release": "We are getting ready to make your data public.",
  "Import in Progress": "We are getting ready to make your data public.",
  "Released": "Your data is now live on the portal!",
  "Not Curatable": "We reviewed your submission, but unfortunately it doesn't have enough data to move forward at this time.",
};

// Helper function to get step number for status
const getStepNumber = (status: string, trackType: 'suggested-papers' | 'submitted-data' = 'suggested-papers') => {
  const suggestedPapersNormalFlow = [
    'Submitted', 'Initial Review', 'Approved for Portal', 'Curation in Progress',
    'Final Review', 'Preparing for Release', 'Released'
  ];

  const submittedDataNormalFlow = [
    'Submitted', 'Initial Review', 'Approved for Portal', 'Curation in Progress',
    'Final Review', 'Preparing for Release', 'Released'
  ];

  const suggestedPapersRejectedFlow = ['Submitted', 'Initial Review', 'Not Curatable'];
  const submittedDataRejectedFlow = ['Submitted', 'Initial Review', 'Not Curatable'];

  // Map certain statuses to appropriate progress steps
  const getMappedStatus = (status: string): string => {
    if (['Awaiting Review', 'Submission', 'Received'].includes(status)) return 'Submitted';
    if (["Awaiting Submitter's Response", 'Awaiting Submitters Response', 'Clarification Needed', 'Changes Requested', 'Curation in Progress', 'In Progress'].includes(status)) {
      return 'Curation in Progress';
    }
    if (['Import in Progress'].includes(status)) return 'Preparing for Release';
    if (status === 'Under Review') return 'Final Review';
    if (status === 'Approved for Portal Curation') return 'Approved for Portal';
    if (status === 'In Portal') return 'Released';
    return status;
  };

  const isRejected = status === 'Not Curatable' || status === 'Missing Data';
  
  // Determine which flow to use and get the appropriate total steps
  let flowSteps: string[];
  if (isRejected) {
    flowSteps = trackType === 'suggested-papers' ? suggestedPapersRejectedFlow : submittedDataRejectedFlow;
    const stepIndex = flowSteps.indexOf('Not Curatable');
    return stepIndex >= 0 ? `${stepIndex + 1}/${flowSteps.length}` : '';
  } else {
    flowSteps = trackType === 'suggested-papers' ? suggestedPapersNormalFlow : submittedDataNormalFlow;
    const mappedStatus = getMappedStatus(status);
    const stepIndex = flowSteps.indexOf(mappedStatus);
    return stepIndex >= 0 ? `${stepIndex + 1}/${flowSteps.length}` : '';
  }
};

export const getStatusCellRenderer = (params: any) => {
  const colorClass = statusColors[params.value] || "bg-gray-200 text-gray-700";
  const description = statusDescriptions[params.value];
  // Ensure we're getting the trackType from the correct source
  const trackType = params.context?.trackType || params.data?.trackType || 'suggested-papers';
  const stepNumber = getStepNumber(params.value, trackType);
  
  const statusPill = React.createElement('div', {
    className: 'w-full flex justify-start items-center h-full pl-3'
  }, React.createElement('div', {
    className: `text-center rounded-full px-[15px] py-2.5 text-sm font-semibold inline-block cursor-help ${colorClass} flex items-center gap-2 whitespace-nowrap`
  }, [
    stepNumber && React.createElement('span', {
      key: 'step',
      className: 'text-xs bg-white bg-opacity-20 rounded-full px-2 py-0.5 font-bold'
    }, stepNumber),
    React.createElement('span', {
      key: 'status'
    }, params.value)
  ]));

  if (description) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {statusPill}
          </TooltipTrigger>
          <TooltipContent>
            <p>{description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return statusPill;
};
