import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
  Bar,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CumulativeGrowthChartProps {
  data: any[];
  unknownYearCount: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'white',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      padding: '10px 14px',
      fontSize: '12px',
      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.08)',
    }}>
      <p style={{ fontWeight: 600, marginBottom: 6, color: '#444' }}>Year: {label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ color: entry.color, margin: '2px 0' }}>
          {entry.name}:{' '}
          <strong>
            {typeof entry.value === 'number'
              ? entry.value >= 1000
                ? `${(entry.value / 1000).toFixed(1)}K`
                : entry.value.toLocaleString()
              : entry.value}
          </strong>
        </p>
      ))}
    </div>
  );
};

const CumulativeGrowthChart: React.FC<CumulativeGrowthChartProps> = ({ data }) => {
  return (
    <Card className="bg-white shadow-md border border-slate-100">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-700">
          Cumulative Growth Over Time
        </CardTitle>
        <p className="text-xs text-gray-400">
          Bars: studies added per year · Lines: cumulative totals
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ left: 10, right: 55, top: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />

              <XAxis
                dataKey="year"
                type="category"
                tick={{ fontSize: 11, fill: '#888' }}
                axisLine={{ stroke: '#e0e0e0' }}
                tickLine={false}
              />

              {/*
               * LEFT axis — studies scale (0–600)
               * Used by: New Studies bars + Total Studies line
               * These two share a scale because both count studies
               */}
              <YAxis
                yAxisId="left"
                orientation="left"
                tick={{ fontSize: 10, fill: '#888' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v.toLocaleString()}
                width={38}
                label={{
                  value: 'Studies',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 5,
                  style: { textAnchor: 'middle', fill: '#888', fontSize: '10px' },
                }}
              />

              {/*
               * RIGHT axis — samples scale (0–400K)
               * Used by: Total Samples line only
               */}
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10, fill: '#d95f02' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}K` : v.toLocaleString()}
                width={45}
                label={{
                  value: 'Samples',
                  angle: 90,
                  position: 'insideRight',
                  offset: -5,
                  style: { textAnchor: 'middle', fill: '#d95f02', fontSize: '10px' },
                }}
              />

              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />

              {/* Bars — new studies added per year (left axis) */}
              <Bar
                yAxisId="left"
                dataKey="newStudies"
                name="New Studies / Year"
                fill="#7570b3"
                fillOpacity={0.6}
                radius={[3, 3, 0, 0]}
                barSize={16}
              />

              {/* Line — cumulative total studies (left axis, same scale as bars) */}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="cumulativeStudies"
                name="Total Studies"
                stroke="#1b9e77"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />

              {/* Line — cumulative total samples (right axis) */}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulativeSamples"
                name="Total Samples"
                stroke="#d95f02"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

export default CumulativeGrowthChart;
