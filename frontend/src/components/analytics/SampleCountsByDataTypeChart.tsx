import React from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

interface SampleCountsByDataTypeChartProps {
  data: Array<{ name: string; count: number }>;
  selectedYear: number;
  availableYears: number[];
  onYearChange: (year: number) => void;
  isLoading: boolean;
}

// cBioPortal Dark2 palette
const COLORS = [
  '#1b9e77', '#d95f02', '#7570b3', '#66a61e',
  '#e6ab02', '#a6761d', '#666666', '#1b9e77',
  '#d95f02', '#7570b3', '#66a61e', '#e6ab02',
  '#a6761d', '#666666', '#1b9e77',
];

const CustomContent = (props: any) => {
  const { x, y, width, height, name, value, depth, index } = props;
  // Only render leaf nodes (depth > 0), skip root container
  if (!name || depth === 0 || !width || !height) return null;
  const color = COLORS[index % COLORS.length];
  const showLabel = width > 50 && height > 28;
  const showCount = width > 70 && height > 48;
  const label = String(name);
  const maxChars = Math.floor(width / 7);

  return (
    <g>
      <rect
        x={x + 1}
        y={y + 1}
        width={width - 2}
        height={height - 2}
        fill={color}
        fillOpacity={0.85}
        rx={3}
        stroke="white"
        strokeWidth={1.5}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showCount ? 8 : 0)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize={Math.min(12, Math.max(9, width / 10))}
          fontWeight={600}
          style={{ pointerEvents: 'none' }}
        >
          {label.length > maxChars ? label.slice(0, maxChars) + '…' : label}
        </text>
      )}
      {showCount && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize={10}
          fillOpacity={0.85}
          style={{ pointerEvents: 'none' }}
        >
          {value >= 1000 ? `${(value / 1000).toFixed(1)}K` : Number(value).toLocaleString()}
        </text>
      )}
    </g>
  );
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0].payload;
  return (
    <div style={{
      background: 'white',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      padding: '8px 12px',
      fontSize: '12px',
      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.08)',
    }}>
      <p style={{ fontWeight: 600, color: '#444', marginBottom: 2 }}>{name}</p>
      <p style={{ color: '#666' }}>{value.toLocaleString()} samples</p>
    </div>
  );
};

const SampleCountsByDataTypeChart: React.FC<SampleCountsByDataTypeChartProps> = ({
  data,
  selectedYear,
  availableYears,
  onYearChange,
  isLoading
}) => {
  const treemapData = data.map((d, i) => ({
    name: d.name,
    size: d.count,
    value: d.count,
    colorIndex: i,
  }));

  return (
    <Card className="bg-white shadow-md border border-slate-100">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-xl font-bold text-gray-900">
              Sample Counts by Data Type
            </CardTitle>
            <p className="text-xs text-gray-400 mt-1">
              Distinct samples per profile type — area proportional to count
            </p>
          </div>
          <Select
            value={selectedYear.toString()}
            onValueChange={(value) => onYearChange(parseInt(value))}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : data.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              No data for {selectedYear}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={treemapData}
                dataKey="size"
                aspectRatio={4 / 3}
                content={<CustomContent />}
              >
                <Tooltip content={<CustomTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SampleCountsByDataTypeChart;
