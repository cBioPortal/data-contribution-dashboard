
import React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { suggestedPapersNormalFlow, submittedDataNormalFlow, stepDescriptions } from './flowDefinitions';

interface SubmissionProgressKeyProps {
  trackType: 'suggested-papers' | 'submitted-data';
}

// Step circle colors — pastel fills with dark text for readability at small sizes
const stepColors: Record<string, { bg: string; text: string }> = {
  'Submitted':              { bg: 'bg-gray-200',   text: 'text-gray-600' },
  'Initial Review':         { bg: 'bg-sky-200',    text: 'text-sky-800' },
  'Approved for Portal':    { bg: 'bg-green-200',  text: 'text-green-800' },
  'Curation in Progress':   { bg: 'bg-yellow-200', text: 'text-yellow-800' },
  'Final Review':           { bg: 'bg-orange-200', text: 'text-orange-800' },
  'In Review':              { bg: 'bg-orange-200', text: 'text-orange-800' },
  'Preparing for Release':  { bg: 'bg-teal-200',   text: 'text-teal-800' },
  'Released':               { bg: 'bg-green-800',  text: 'text-white' },
};

export const SubmissionProgressKey = ({ trackType }: SubmissionProgressKeyProps) => {
  const flowSteps = trackType === 'suggested-papers' ? suggestedPapersNormalFlow : submittedDataNormalFlow;

  return (
    <TooltipProvider>
      <div className="bg-blue-50 rounded-lg border border-blue-200 p-4 mb-6">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Curation Pipeline</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {'Submissions move through these stages during the cBioPortal curation process. Hover over each step for details.'}
          </p>
        </div>

        {/* Flow Steps */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-4">
          {flowSteps.map((step, index) => {
            const color = stepColors[step] ?? { bg: 'bg-gray-300', text: 'text-gray-700' };
            return (
              <div key={step} className="flex items-center gap-2 flex-shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 cursor-help">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${color.bg}`}>
                        <span className={`text-xs font-semibold ${color.text}`}>{index + 1}</span>
                      </div>
                      <span className="text-sm text-gray-700 whitespace-nowrap">{step}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{stepDescriptions[step]}</p>
                  </TooltipContent>
                </Tooltip>
                {index < flowSteps.length - 1 && (
                  <div className="w-4 h-0.5 bg-gray-300 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>


      </div>
    </TooltipProvider>
  );
};
