

import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchCancerStudies, fetchSamples, fetchStudiesCount, fetchPatientsCount, fetchCancerTypeSamples } from '@/services/cbioportalApi';
import { parseIssuesData, parsePullRequestsData } from '@/utils/dataParser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import SamplesByCancerTypeChart from '@/components/analytics/SamplesByCancerTypeChart';
import { BarChart3, ArrowRight, FlaskConical, FileText, GitBranch, Users } from 'lucide-react';
import issuesData from '@/data/issues.txt?raw';
import pullRequestsData from '@/data/pull_requests.txt?raw';

const AnalyticsPreview: React.FC = () => {
  // Fetch counts via META projection — fast, no full payload
  const { data: studiesCount, isLoading: studiesLoading } = useQuery({
    queryKey: ['studies-count'],
    queryFn: fetchStudiesCount,
  });

  const { data: samplesCount, isLoading: samplesLoading } = useQuery({
    queryKey: ['samples-count'],
    queryFn: fetchSamples,
  });

  const { data: patientsCount, isLoading: patientsLoading } = useQuery({
    queryKey: ['patients-count'],
    queryFn: fetchPatientsCount,
  });

  // Still need full studies for the chart data + cancer types count
  const { data: studies, isLoading: cancerTypesLoading } = useQuery({
    queryKey: ['cancer-studies'],
    queryFn: fetchCancerStudies,
  });

  const cancerTypesCount = React.useMemo(() => {
    if (!studies) return 0;
    return new Set(studies.filter((s: any) => s.cancerTypeId && s.cancerTypeId !== 'mixed').map((s: any) => s.cancerTypeId)).size;
  }, [studies]);

  // Fetch top 5 cancer type samples from ClickHouse via backend
  const { data: samplesByCancerType = [] } = useQuery({
    queryKey: ['cancer-type-samples-preview'],
    queryFn: () => fetchCancerTypeSamples(5),
  });

  // Parse tracker data (best-effort)
  let trackerPapers: any[] = [];
  let trackerData: any[] = [];
  try {
    trackerPapers = parseIssuesData(issuesData);
    trackerData = parsePullRequestsData(pullRequestsData);
  } catch (error) {
    console.error('Error parsing tracker data:', error);
  }

  const top5SamplesByCancerType = samplesByCancerType;

  // Metrics tiles
  const isLoading = studiesLoading || samplesLoading || cancerTypesLoading || patientsLoading;

  const metrics = [
    {
      title: 'Total Studies',
      value: studiesLoading ? '...' : `${studiesCount || 0}`,
      icon: FileText,
      valueColor: '#1b9e77',
      iconColor: '#1b9e77',
      bgColor: '#d4f0e7',
    },
    {
      title: 'Cancer Types',
      value: cancerTypesLoading ? '...' : `${cancerTypesCount || 0}`,
      icon: GitBranch,
      valueColor: '#7570b3',
      iconColor: '#7570b3',
      bgColor: '#e5e4f3',
    },
    {
      title: 'Total Patients',
      value: patientsLoading ? '...' : `${Math.round((patientsCount || 0) / 1000)}K+`,
      icon: Users,
      valueColor: '#e6ab02',
      iconColor: '#e6ab02',
      bgColor: '#fdf0c0',
    },
    {
      title: 'Total Samples',
      value: samplesLoading ? '...' : samplesCount > 0 ? `${Math.round(samplesCount / 1000)}K+` : '0',
      icon: FlaskConical,
      valueColor: '#d95f02',
      iconColor: '#d95f02',
      bgColor: '#fce8d5',
    },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-8">

      <div>
        {/* Header */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold mb-1" style={{color: '#1A3B6D'}}>Dashboard Overview</h2>
          <p className="text-slate-500 text-sm max-w-2xl mx-auto">
            Real-time insights into cancer genomics data curated in cBioPortal
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-6">
          {/* Metrics */}
          <div className="xl:col-span-2 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {metrics.map((metric, idx) => {
                const Icon = metric.icon;
                return (
                  <Card
                    key={idx}
                    className="group shadow-md hover:shadow-lg transition-all duration-300 border border-slate-100 overflow-hidden"
                  >
                    <CardContent className="p-5">
                      <Icon className="h-6 w-6 mb-4 group-hover:scale-110 transition-transform duration-300" style={{color: metric.iconColor}} />
                      <div className="space-y-1">
                        <div
                          className="text-3xl font-bold"
                          style={{color: metric.valueColor}}
                        >
                          {metric.value}
                        </div>
                        <div className="text-sm font-medium text-slate-600">
                          {metric.title}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Chart */}
          <div className="xl:col-span-3">
            <Card className="h-full border border-slate-100 shadow-md overflow-visible">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-700">
                  Top 5 Cancer Types by Sample Count
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-5">
                <div className="h-48 md:h-52 lg:h-60 overflow-visible">
                  <SamplesByCancerTypeChart
                    data={top5SamplesByCancerType}
                    isLoading={false}
                    variant="embedded"
                    height={240}
                    maxBars={5}
                    barSize={18}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <Link to="/analytics">
            <Button
              size="lg"
              className="group text-white px-8 py-2.5 text-sm font-semibold transition-all duration-200 shadow-sm hover:shadow-md hover:scale-105 rounded-lg"
              style={{backgroundColor: '#2C5EBE'}}
            >
              <BarChart3 className="mr-3 h-6 w-6 group-hover:rotate-12 transition-transform duration-300" />
              Explore Complete Analytics
              <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-1 transition-transform duration-300" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPreview;

