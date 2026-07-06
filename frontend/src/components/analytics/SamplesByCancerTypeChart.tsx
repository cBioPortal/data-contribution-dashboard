import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface SamplesByCancerTypeChartProps {
  data: Array<{ name: string; samples: number; studies: number; cancerTypeId: string }>;
  isLoading: boolean;
  variant?: 'full' | 'embedded';
  height?: number;
  maxBars?: number;
  barSize?: number;
}

// cBioPortal frontend colors — StudyViewConfig + Colors.ts
const COLORS = [
  "#1b9e77", // teal
  "#7570b3", // muted purple
  "#d95f02", // burnt orange
  "#66a61e", // olive green
  "#e6ab02", // gold
  "#a6761d", // brown
  "#666666", // gray
  "#1b9e77", "#7570b3", "#d95f02", "#66a61e",
  "#e6ab02", "#a6761d", "#666666", "#1b9e77",
  "#7570b3", "#d95f02", "#66a61e", "#e6ab02"
];

const SamplesByCancerTypeChart: React.FC<SamplesByCancerTypeChartProps> = ({ 
  data, 
  isLoading, 
  variant = 'full',
  height = 600,
  maxBars = 20,
  barSize = 22
}) => {
  // Wait for two browser paint frames before rendering the chart.
  // This ensures ResponsiveContainer measures the correct container dimensions
  // after the browser has fully laid out the page, preventing clipped Y-axis labels.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!data || data.length === 0) return;
    setReady(false);
    let raf1: number, raf2: number;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [data]);

  const sortedData = data
    .map(item => ({
      ...item,
      samples: Math.round(item.samples),
    }))
    .sort((a, b) => b.samples - a.samples)
    .slice(0, maxBars)

  // Use smaller margins for embedded variant but ensure space for labels
  const chartMargin = variant === 'embedded' 
    ? { top: 10, right: 20, left: 0, bottom: 30 }
    : { top: 20, right: 30, left: 0, bottom: 40 };

  const chartComponent = (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={sortedData}
        layout="vertical"
        margin={chartMargin}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e8eef7" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 12, fill: '#666' }}
          axisLine={{ stroke: '#ccc' }}
          tickLine={{ stroke: '#ccc' }}
          tickFormatter={(value) => Math.round(value).toLocaleString()}
          domain={[0, 'dataMax']}
          ticks={[0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000]}
          label={{
            value: 'Number of Samples',
            position: 'insideBottom',
            offset: -15,
            style: { textAnchor: 'middle', fontSize: '12px', fill: '#888' }
          }}
        />
        <YAxis
          type="category"
          dataKey="name"
          interval={0}
          axisLine={{ stroke: '#ccc' }}
          tickLine={false}
          width={160}
          tick={(props) => {
            const { x, y, payload } = props;
            const value: string = payload.value;
            // Only wrap labels longer than 18 chars
            if (value.length <= 18) {
              return (
                <g transform={`translate(${x},${y})`}>
                  <text x={0} y={4} textAnchor="end" fill="#555" fontSize={11}>{value}</text>
                </g>
              );
            }
            const words = value.split(' ');
            const mid = Math.ceil(words.length / 2);
            const line1 = words.slice(0, mid).join(' ');
            const line2 = words.slice(mid).join(' ');
            return (
              <g transform={`translate(${x},${y})`}>
                <text x={0} y={-5} textAnchor="end" fill="#555" fontSize={11}>{line1}</text>
                {line2 && <text x={0} y={8} textAnchor="end" fill="#555" fontSize={11}>{line2}</text>}
              </g>
            );
          }}
          label={{
            value: 'Cancer Type',
            angle: -90,
            position: 'insideLeft',
            offset: 15,
            style: { textAnchor: 'middle', fontSize: '12px', fill: '#888' }
          }}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (active && payload && payload.length) {
              const data = payload[0].payload;
              return (
                <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
                  <p className="font-semibold text-gray-900 mb-2">{label}</p>
                  <p className="text-blue-600">
                    <span className="font-medium">Samples:</span> {Math.round(data.samples).toLocaleString()}
                  </p>
                  <p className="text-green-600">
                    <span className="font-medium">Studies:</span> {data.studies}
                  </p>
                </div>
              );
            }
            return null;
          }}
        />
        <Bar dataKey="samples" radius={[0, 6, 6, 0]} barSize={barSize}>
          {sortedData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );

  if (variant === 'embedded') {
    if (isLoading || !ready) {
      return (
        <div className="flex items-center justify-center" style={{ height }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      );
    }

    if (!data || data.length === 0) {
      return (
        <div className="flex items-center justify-center" style={{ height }}>
          <div className="text-center text-gray-500">
            <p>No data available</p>
          </div>
        </div>
      );
    }

    return chartComponent;
  }

  // Full variant with Card wrapper (existing behavior)
  if (isLoading || !ready) {
    return (
      <Card className="bg-white shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-gray-900">
            Samples by Cancer Type
          </CardTitle>
          <p className="text-sm text-gray-600">
            Top {maxBars} cancer types by sample count with study information
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-96 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="bg-white shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-gray-900">
            Samples by Cancer Type
          </CardTitle>
          <p className="text-sm text-gray-600">
            Top {maxBars} cancer types by sample count with study information
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-96 flex items-center justify-center">
            <div className="text-center text-gray-500">
              <p>No data available</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-gray-900">
          Samples by Cancer Type
        </CardTitle>
        <p className="text-sm text-gray-600">
          Top {maxBars} cancer types by sample count with study information
        </p>
      </CardHeader>
      <CardContent>
        <div className="w-full">
          {chartComponent}
        </div>
      </CardContent>
    </Card>
  );
};

export default SamplesByCancerTypeChart;
