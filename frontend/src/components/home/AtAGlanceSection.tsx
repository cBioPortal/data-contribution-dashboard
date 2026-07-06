
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCancerStudies } from '@/services/cbioportalApi';
import { parseIssuesData, parsePullRequestsData } from '@/utils/dataParser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Database, FileText, Activity } from 'lucide-react';
import issuesData from '@/data/issues.txt?raw';
import pullRequestsData from '@/data/pull_requests.txt?raw';
import sampleCountCancerTypeData from '@/data/Sample_count_cancer_type.csv?raw';

const AtAGlanceSection = () => {
  // Fetch studies data for total studies curated
  const { data: studies, isLoading: studiesLoading } = useQuery({
    queryKey: ['cancer-studies'],
    queryFn: fetchCancerStudies,
  });

  // Parse tracker data for datasets submitted and papers linked
  let trackerPapers: any[] = [];
  let trackerData: any[] = [];

  try {
    trackerPapers = parseIssuesData(issuesData);
    trackerData = parsePullRequestsData(pullRequestsData);
  } catch (error) {
    console.error("Error parsing tracker data:", error);
  }

  const totalSubmissions = trackerPapers.length + trackerData.length;
  
  // Set papers with PMID to 382
  const papersWithPMID = 382;

  // Parse CSV data for top cancer types
  const parseSampleCountData = (csvData: string) => {
    const lines = csvData.trim().split('\n');
    
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.replace(/"/g, ''));
      return {
        name: values[0],
        samples: parseInt(values[1])
      };
    }).filter(item => item.samples > 0).slice(0, 5);
  };

  const topCancerTypes = parseSampleCountData(sampleCountCancerTypeData);

  // Calculate curation status breakdown
  const allSubmissions = [...trackerPapers, ...trackerData];
  let submittedCount = 0;
  let releasedCount = 0;

  allSubmissions.forEach((submission: any) => {
    const status = submission.status?.toLowerCase() || '';
    if (status.includes('released') || status.includes('in portal')) {
      releasedCount++;
    } else {
      submittedCount++;
    }
  });

  const curationStatusData = [
    { name: 'Released', value: releasedCount, color: '#6b7280' },
    { name: 'In Progress', value: submittedCount, color: '#9ca3af' }
  ];

  const StatCard = ({ icon: Icon, title, value, subtitle }: {
    icon: any;
    title: string;
    value: string | number;
    subtitle: string;
  }) => (
    <Card className="border border-slate-200 bg-white shadow-sm hover:shadow-md transition-all duration-200">
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 text-slate-600">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-2xl font-bold text-slate-800">
              {studiesLoading && title === "Studies Curated" ? (
                <span className="animate-pulse">...</span>
              ) : (
                value
              )}
            </p>
            <p className="text-sm font-medium text-slate-700">{title}</p>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="bg-white p-3 rounded-xl shadow-lg border border-slate-200">
          <p className="font-semibold text-slate-800">{data.name}</p>
          <p className="text-sm">
            <span className="font-medium" style={{ color: data.color }}>
              Count: {data.value}
            </span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-gradient-to-br from-white to-slate-50/50 rounded-3xl border border-slate-200 shadow-lg p-8">
      {/* Header */}
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold text-slate-800 mb-3">Community Insights</h2>
        <p className="text-slate-600 max-w-2xl mx-auto">
          Real-time data about our community contributions and research impact
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <StatCard
          icon={Database}
          title="Studies Curated"
          value={studies?.length || 0}
          subtitle="Published studies in portal"
        />
        <StatCard
          icon={Activity}
          title="Datasets in Queue"
          value={totalSubmissions}
          subtitle="Community submissions"
        />
        <StatCard
          icon={FileText}
          title="Papers Linked"
          value={papersWithPMID}
          subtitle="With PMID references"
        />
      </div>

      {/* Charts Section - Reduced Size */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Cancer Types - Reduced Size with Grey Colors */}
        <Card className="border border-slate-200 bg-white shadow-md">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-slate-800 flex items-center gap-3">
              <div className="w-3 h-3 bg-gray-500 rounded-full"></div>
              Top Cancer Types
            </CardTitle>
            <p className="text-sm text-slate-500">Most studied cancer types by sample count</p>
          </CardHeader>
          <CardContent className="pb-6">
            <div className="space-y-3">
              {topCancerTypes.map((type, index) => {
                const percentage = (type.samples / topCancerTypes[0].samples) * 100;
                const colors = [
                  'bg-gradient-to-r from-gray-600 to-gray-500',
                  'bg-gradient-to-r from-gray-500 to-gray-400',
                  'bg-gradient-to-r from-gray-500 to-gray-400',
                  'bg-gradient-to-r from-gray-400 to-gray-300',
                  'bg-gradient-to-r from-gray-400 to-gray-300'
                ];
                return (
                  <div key={index}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-700 truncate max-w-[180px]" title={type.name}>
                        {type.name}
                      </span>
                      <span className="text-sm font-semibold text-slate-600">
                        {type.samples.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div 
                        className={`${colors[index]} h-full rounded-full transition-all duration-1000 ease-out`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Curation Status - Reduced Size with Grey Colors */}
        <Card className="border border-slate-200 bg-white shadow-md">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-slate-800 flex items-center gap-3">
              <div className="w-3 h-3 bg-gray-500 rounded-full"></div>
              Curation Status
            </CardTitle>
            <p className="text-sm text-slate-500">Current status of submitted datasets</p>
          </CardHeader>
          <CardContent className="pb-6">
            <div className="flex items-center justify-between">
              <div className="w-24 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={curationStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={48}
                      dataKey="value"
                      startAngle={90}
                      endAngle={-270}
                    >
                      {curationStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === 0 ? '#6b7280' : '#9ca3af'} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 ml-6 space-y-2">
                {curationStatusData.map((status, index) => (
                  <div key={index} className="flex items-center justify-between p-2.5 bg-gradient-to-r from-slate-50 to-white rounded-lg border border-slate-100">
                    <div className="flex items-center space-x-2">
                      <div 
                        className={`w-3 h-3 rounded-full ${index === 0 ? 'bg-gray-500' : 'bg-gray-400'}`}
                      />
                      <span className="font-medium text-slate-700 text-sm">{status.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-slate-800">{status.value}</span>
                      <p className="text-xs text-slate-500">datasets</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AtAGlanceSection;
