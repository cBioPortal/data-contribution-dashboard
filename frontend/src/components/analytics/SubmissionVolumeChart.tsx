import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, ComposedChart, CartesianGrid,
  XAxis, YAxis, Tooltip, Legend, Bar,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchSubmissionVolume } from '@/services/cbioportalApi';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-md text-sm">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill }}>
          {p.name}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  );
};

const SubmissionVolumeChart: React.FC = () => {
  const { data = [], isLoading } = useQuery({
    queryKey: ['submission-volume'],
    queryFn: fetchSubmissionVolume,
  });

  // Format month label: "2026-03" → "Mar 2026"
  const formatted = data.map((d: any) => ({
    ...d,
    label: new Date(d.month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
  }));

  const total = data.reduce((s: number, d: any) => s + d.total, 0);

  return (
    <Card className="bg-white shadow-md border border-slate-100">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-gray-900">
          Submission Volume Over Time
        </CardTitle>
        <p className="text-sm text-gray-500">
          {total} total submission{total !== 1 ? 's' : ''} by month
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : formatted.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              No submissions yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={formatted} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#888' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#888' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: 8 }} />
                <Bar
                  dataKey="Study Suggestion"
                  stackId="a"
                  fill="#1b9e77"
                  fillOpacity={0.85}
                  radius={[0, 0, 0, 0]}
                  barSize={32}
                />
                <Bar
                  dataKey="Data Submission"
                  stackId="a"
                  fill="#d95f02"
                  fillOpacity={0.85}
                  radius={[4, 4, 0, 0]}
                  barSize={32}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SubmissionVolumeChart;
