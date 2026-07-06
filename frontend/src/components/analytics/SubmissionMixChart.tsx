import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchSubmissionMix } from '@/services/cbioportalApi';

type Dimension = 'type' | 'publication' | 'sharing';

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'publication', label: 'Publication' },
  { key: 'sharing', label: 'Sharing' },
];

// Stable colours per category label (aligned with the tracker source badges)
const COLORS: Record<string, string> = {
  'Data Submission': '#2986E2',
  'Study Suggestion': '#7570b3',
  'Published': '#16a34a',
  'Pre-publication': '#d97706',
  'Public': '#0ea5e9',
  'Private': '#e6ab02',
};

const CustomTooltip = ({ active, payload, total }: any) => {
  if (!active || !payload?.length) return null;
  const { name, count } = payload[0].payload;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-md text-sm">
      <p className="font-semibold text-gray-800">{name}</p>
      <p className="text-gray-600">{count} submission{count !== 1 ? 's' : ''} · {pct}%</p>
    </div>
  );
};

const SubmissionMixChart: React.FC = () => {
  const [dimension, setDimension] = useState<Dimension>('type');

  const { data, isLoading } = useQuery({
    queryKey: ['submission-mix'],
    queryFn: fetchSubmissionMix,
  });

  const series =
    dimension === 'type' ? data?.byType
    : dimension === 'publication' ? data?.byPublication
    : data?.bySharing;

  const slices = series ?? [];
  const total = slices.reduce((s, d) => s + d.count, 0);

  return (
    <Card className="bg-white shadow-md border border-slate-100">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-xl font-bold text-gray-900">
              Submission Mix
            </CardTitle>
            <p className="text-sm text-gray-500">
              Composition of submissions by {DIMENSIONS.find(d => d.key === dimension)!.label.toLowerCase()}
            </p>
          </div>
          {/* Dimension toggle */}
          <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
            {DIMENSIONS.map(d => (
              <button
                key={d.key}
                onClick={() => setDimension(d.key)}
                className={`text-xs font-medium px-2.5 py-1 transition-colors ${
                  dimension === d.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : total === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              No submissions yet
            </div>
          ) : (
            <div className="flex items-center h-full gap-4">
              {/* Donut */}
              <div className="relative h-full flex-1 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={slices}
                      dataKey="count"
                      nameKey="name"
                      innerRadius="58%"
                      outerRadius="85%"
                      paddingAngle={2}
                      stroke="none"
                    >
                      {slices.map((entry, i) => (
                        <Cell key={i} fill={COLORS[entry.name] || '#888'} fillOpacity={0.9} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip total={total} />} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center total */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-bold text-gray-900">{total}</span>
                  <span className="text-xs text-gray-400">total</span>
                </div>
              </div>

              {/* Legend */}
              <ul className="space-y-2 shrink-0 pr-2">
                {slices.map((entry, i) => {
                  const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
                  return (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span
                        className="inline-block w-3 h-3 rounded-sm shrink-0"
                        style={{ backgroundColor: COLORS[entry.name] || '#888' }}
                      />
                      <span className="text-gray-700">{entry.name}</span>
                      <span className="text-gray-400 ml-auto tabular-nums">
                        {entry.count} · {pct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SubmissionMixChart;
