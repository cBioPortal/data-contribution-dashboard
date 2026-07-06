
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface StatisticsCardsProps {
  studies: any[] | undefined;
  totalSamples: number;
  totalCancerTypes: number;
  lastUpdated: string;
  isLoading: boolean;
}

const StatisticsCards: React.FC<StatisticsCardsProps> = ({
  studies,
  totalSamples,
  totalCancerTypes,
  lastUpdated,
  isLoading
}) => {
  return (
    <>
      {/* Platform Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <Card className="bg-white shadow-md border border-slate-100">
          <CardContent className="p-8">
            <div>
              <p className="text-gray-500 text-sm mb-2 font-medium">Studies In cBioPortal</p>
              <p className="text-4xl font-bold" style={{color: '#2C5EBE'}}>
                {isLoading ? '...' : studies?.length || 0}
              </p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white shadow-md border border-slate-100">
          <CardContent className="p-8">
            <div>
              <p className="text-gray-500 text-sm mb-2 font-medium">Samples</p>
              <p className="text-4xl font-bold" style={{color: '#2C5EBE'}}>
                {isLoading ? '...' : totalSamples.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white shadow-md border border-slate-100">
          <CardContent className="p-8">
            <div>
              <p className="text-gray-500 text-sm mb-2 font-medium">Cancer Types</p>
              <p className="text-4xl font-bold" style={{color: '#2C5EBE'}}>
                {isLoading ? '...' : totalCancerTypes}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-md border border-slate-100">
          <CardContent className="p-8">
            <div>
              <p className="text-gray-500 text-sm mb-2 font-medium">Last Updated</p>
              <p className="text-lg font-semibold" style={{color: '#2C5EBE'}}>
                {lastUpdated}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default StatisticsCards;
