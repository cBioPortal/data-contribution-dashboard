import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, CartesianGrid,
  XAxis, YAxis, Tooltip, Cell, Bar, LabelList,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchPipelineFunnel } from '@/services/cbioportalApi';

const STAGE_COLORS: Record<string, string> = {
  'Submitted':             '#7570b3',
  'Initial Review':        '#1b9e77',
  'Approved for Portal':   '#66a61e',
  'Curation in Progress':  '#d95f02',
  'Final Review':          '#e6ab02',
  'Preparing for Release': '#a6761d',
  'Released':              '#2986E2',
  'Not Curatable':         '#999999',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const { stage, count } = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-md text-sm">
      <p className="font-semibold text-gray-800">{stage}</p>
      <p className="text-gray-600">{count} submission{count !== 1 ? 's' : ''}</p>
    </div>
  );
};

const PipelineFunnelChart: React.FC = () => {
  const { data = [], isLoading } = useQuery({
    queryKey: ['pipeline-funnel'],
    queryFn: fetchPipelineFunnel,
  });

  const total = data.reduce((s: number, d: any) => s + d.count, 0);

  // Order: pipeline steps first, Not Curatable last
  const ordered = [
    ...data.filter((d: any) => d.stage !== 'Not Curatable'),
    ...data.filter((d: any) => d.stage === 'Not Curatable'),
  ];

  return (
    <Card className="bg-white shadow-md border border-slate-100">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-gray-900">
          Status of Pipeline Studies
        </CardTitle>
        <p className="text-sm text-gray-500">
          {total} submission{total !== 1 ? 's' : ''} across workflow stages
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : ordered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              No submissions yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={ordered}
                layout="vertical"
                margin={{ top: 4, right: 50, left: 10, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#888' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="stage"
                  tick={{ fontSize: 11, fill: '#555' }}
                  axisLine={false}
                  tickLine={false}
                  width={155}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                  <LabelList
                    dataKey="count"
                    position="right"
                    style={{ fontSize: 11, fill: '#888' }}
                  />
                  {ordered.map((entry: any, i: number) => (
                    <Cell
                      key={i}
                      fill={STAGE_COLORS[entry.stage] || '#888'}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default PipelineFunnelChart;
