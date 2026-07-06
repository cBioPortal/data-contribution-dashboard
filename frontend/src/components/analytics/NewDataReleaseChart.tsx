import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { fetchNewsReleases } from '@/services/cbioportalApi';

const NewDataReleaseChart: React.FC = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['news-releases'],
    queryFn: fetchNewsReleases,
    staleTime: 1000 * 60 * 60,
  });

  const latest = data?.latest;

  return (
    <Card className="bg-white shadow-md">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-gray-900">
          New Data Release
        </CardTitle>
        <p className="text-sm text-gray-600">
          Latest data additions to cBioPortal
        </p>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        )}

        {isError && (
          <div className="text-sm text-red-500 py-4 text-center">
            Failed to load release data.
          </div>
        )}

        {!isLoading && !isError && latest && (
          <>
            {/* Summary badges */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <span className="bg-blue-50 text-blue-700 text-xs font-medium px-3 py-1 rounded-full">
                Release Date: {latest.date}
              </span>
              <span className="bg-green-50 text-green-700 text-xs font-medium px-3 py-1 rounded-full">
                {latest.samples.toLocaleString()} Samples
              </span>
              <span className="bg-purple-50 text-purple-700 text-xs font-medium px-3 py-1 rounded-full">
                {latest.studies} Studies
              </span>
            </div>

            {/* Study list — no scroll, just what fits */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-md font-semibold text-gray-800 mb-3">Recent Studies</h3>
              <ul className="list-disc list-inside text-sm space-y-2">
                {latest.studyList.slice(0, 5).map((study, i) => (
                  <li key={i}>
                    <a
                      href={study.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 hover:text-blue-900 hover:underline leading-snug"
                    >
                      {study.name}
                    </a>
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <a
                  href="https://docs.cbioportal.org/news/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800 inline-flex items-center"
                >
                  See all
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
            </div>
          </>
        )}

        {!isLoading && !isError && !latest && (
          <div className="text-sm text-gray-500 py-4 text-center">
            No release data available.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default NewDataReleaseChart;
