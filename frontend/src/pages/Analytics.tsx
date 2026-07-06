import React, { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import SharedLayout from "@/components/SharedLayout";
import { 
  fetchCancerStudies, 
  fetchCancerTypes,
  fetchSamples,
  fetchStudiesCount,
  fetchCancerTypeSamples,
  fetchCumulativeGrowth,
  fetchSampleCountsByDataType
} from "@/services/cbioportalApi";
import { parseIssuesData, parsePullRequestsData } from "@/utils/dataParser";
import {
  processCumulativeGrowthFromYearCounts
} from "@/utils/analyticsDataProcessors";
import { getAvailableYears } from "@/utils/yearExtractor";
import { logger } from "@/utils/logger";

// Import components
import StatisticsCards from "@/components/analytics/StatisticsCards";
import CumulativeGrowthChart from "@/components/analytics/CumulativeGrowthChart";
import SamplesByCancerTypeChart from "@/components/analytics/SamplesByCancerTypeChart";
import SampleCountsByDataTypeChart from "@/components/analytics/SampleCountsByDataTypeChart";
import NewDataReleaseChart from "@/components/analytics/NewDataReleaseChart";
import PipelineFunnelChart from "@/components/analytics/PipelineFunnelChart";
import SubmissionVolumeChart from "@/components/analytics/SubmissionVolumeChart";
import SubmissionMixChart from "@/components/analytics/SubmissionMixChart";

// Import tracker data (still used for cumulative growth)
import issuesData from "@/data/issues.txt?raw";
import pullRequestsData from "@/data/pull_requests.txt?raw";

const formatLastUpdated = (): string => {
  const now = new Date();
  return `${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} at ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
};

const Analytics = () => {
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<number>(2018);
  const [dataError, setDataError] = useState<boolean>(false);

  useEffect(() => { setLastUpdated(formatLastUpdated()); window.scrollTo(0, 0); }, []);

  const { data: samplesByCancerType = [], isLoading: cancerTypeSamplesLoading } = useQuery({
    queryKey: ['cancer-type-samples'],
    queryFn: () => fetchCancerTypeSamples(20),
  });

  // Parse tracker data (for cumulative growth chart only)
  const { trackerPapers, trackerData } = useMemo(() => {
    let papers: any[] = [];
    let data: any[] = [];
    try {
      papers = parseIssuesData(issuesData);
      data = parsePullRequestsData(pullRequestsData);
    } catch (error) {
      logger.error("Error parsing tracker data:", error);
      toast.error("Failed to load submission tracker data");
      setDataError(true);
    }
    return { trackerPapers: papers, trackerData: data };
  }, []);

  useQuery({ queryKey: ['studies-count'], queryFn: fetchStudiesCount });
  const { data: samplesCount, isLoading: samplesLoading } = useQuery({ queryKey: ['samples-count'], queryFn: fetchSamples });
  const { data: studies, isLoading: studiesLoading, error: studiesError } = useQuery({ queryKey: ['cancer-studies'], queryFn: fetchCancerStudies });
  const { isLoading: typesLoading } = useQuery({ queryKey: ['cancer-types'], queryFn: fetchCancerTypes });
  const { data: sampleCountsByDataType = [], isLoading: sampleCountsLoading } = useQuery({
    queryKey: ['sample-counts-by-datatype', selectedYear],
    queryFn: () => fetchSampleCountsByDataType(selectedYear),
  });
  const { data: cumulativeGrowthRows = [] } = useQuery({ queryKey: ['cumulative-growth'], queryFn: fetchCumulativeGrowth });

  useEffect(() => {
    if (studiesError) {
      logger.error("Error fetching studies:", studiesError);
      toast.error("Failed to load study data from cBioPortal");
    }
  }, [studiesError]);

  const uniqueCancerTypesFromStudies = useMemo(() => {
    if (!studies) return 0;
    return new Set(studies.filter((s: any) => s.cancerTypeId && s.cancerTypeId !== 'mixed').map((s: any) => s.cancerTypeId)).size;
  }, [studies]);

  const totalSamples = samplesCount || 0;

  const { cumulativeGrowthData, unknownYearCount } = useMemo(() => {
    const result = processCumulativeGrowthFromYearCounts(cumulativeGrowthRows);
    return { cumulativeGrowthData: result.data, unknownYearCount: result.unknownYearCount };
  }, [cumulativeGrowthRows]);

  const availableYears = useMemo(() => {
    if (!studies) return [2018];
    return getAvailableYears(studies);
  }, [studies]);

  const isLoading = studiesLoading || typesLoading || samplesLoading;

  if (dataError && !studies) {
    return (
      <SharedLayout>
        <div className="container mx-auto px-6 py-8 bg-gray-50 min-h-screen">
          <div className="max-w-6xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
              <h2 className="text-2xl font-bold text-red-800 mb-2">Unable to Load Analytics Data</h2>
              <p className="text-red-600 mb-4">There was an error loading the analytics data. Please try refreshing the page.</p>
              <button onClick={() => window.location.reload()} className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors">
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
      <div className="container mx-auto px-6 py-8 bg-gray-50 min-h-screen">
        <div className="max-w-6xl mx-auto">

          {/* Page header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-4" style={{ color: '#1A3B6D' }}>cBioPortal Studies Analytics Dashboard</h1>
            <p className="text-gray-600 text-lg mb-4">A snapshot of current and upcoming cancer genomics studies in cBioPortal</p>
          </div>

          {/* Stat cards */}
          <StatisticsCards
            studies={studies}
            totalSamples={totalSamples}
            totalCancerTypes={uniqueCancerTypesFromStudies}
            lastUpdated={lastUpdated}
            isLoading={isLoading}
          />

          {/* Cumulative Growth + New Data Release */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <CumulativeGrowthChart data={cumulativeGrowthData} unknownYearCount={unknownYearCount} />
            <NewDataReleaseChart />
          </div>

          {/* Samples by Cancer Type */}
          <div className="mb-8">
            <SamplesByCancerTypeChart data={samplesByCancerType} isLoading={cancerTypeSamplesLoading} />
          </div>

          {/* Sample Counts by Data Type + Pipeline Funnel side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <SampleCountsByDataTypeChart
              data={sampleCountsByDataType}
              selectedYear={selectedYear}
              availableYears={availableYears}
              onYearChange={setSelectedYear}
              isLoading={sampleCountsLoading}
            />
            <PipelineFunnelChart />
          </div>

          {/* Submission Volume + Submission Mix side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <SubmissionVolumeChart />
            <SubmissionMixChart />
          </div>

        </div>
      </div>
    </SharedLayout>
  );
};

export default Analytics;
