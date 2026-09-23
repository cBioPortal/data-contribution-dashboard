import { BadgeCheck, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface CommunityCurationStatsProps {
  completedCurations: number;
  contributors: number;
  monthlyTrend: Array<{ month: string; completedCurations: number }>;
  isLoading: boolean;
}

const Metric = ({
  icon,
  label,
  value,
  isLoading,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  isLoading: boolean;
}) => (
  <div className="flex min-w-0 items-center gap-3">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
      {icon}
    </div>
    <div>
      {isLoading ? (
        <div className="mb-1 h-7 w-14 animate-pulse rounded bg-gray-200" />
      ) : (
        <p className="text-2xl font-bold leading-none text-[#2C5EBE]">{value.toLocaleString()}</p>
      )}
      <p className="mt-1 text-xs font-medium text-gray-600">{label}</p>
    </div>
  </div>
);

const CommunityCurationStats = ({
  completedCurations,
  contributors,
  monthlyTrend,
  isLoading,
}: CommunityCurationStatsProps) => {
  const maximum = Math.max(...monthlyTrend.map(item => item.completedCurations), 1);

  return (
    <Card className="border border-slate-100 bg-white shadow-md">
      <CardContent className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Community Curation</h2>
        <p className="mt-1 max-w-sm text-xs leading-5 text-gray-500">
          Recognizing community members who help prepare studies for inclusion in cBioPortal.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-5 sm:gap-8 lg:ml-auto">
        <Metric
          icon={<BadgeCheck className="h-5 w-5" />}
          label="Completed Curations"
          value={completedCurations}
          isLoading={isLoading}
        />
        <Metric
          icon={<Users className="h-5 w-5" />}
          label="Community Contributors"
          value={contributors}
          isLoading={isLoading}
        />
      </div>
      <div className="border-t border-slate-100 pt-4 lg:w-64 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <p className="mb-2 text-xs font-semibold text-gray-700">Completed in the last 6 months</p>
        {isLoading ? (
          <div className="h-12 animate-pulse rounded bg-gray-100" />
        ) : (
          <div className="flex h-12 items-end gap-2" aria-label="Monthly completed curation trend">
            {monthlyTrend.map(item => {
              const label = new Date(`${item.month}-01T00:00:00`).toLocaleDateString('en-US', {
                month: 'short',
              });
              return (
                <div key={item.month} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <div
                    title={`${label}: ${item.completedCurations}`}
                    className="w-full min-w-3 rounded-t bg-blue-500"
                    style={{
                      height: item.completedCurations
                        ? `${Math.max(6, (item.completedCurations / maximum) * 30)}px`
                        : '2px',
                      opacity: item.completedCurations ? 1 : 0.2,
                    }}
                  />
                  <span className="text-[9px] text-gray-400">{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </CardContent>
    </Card>
  );
};

export default CommunityCurationStats;
