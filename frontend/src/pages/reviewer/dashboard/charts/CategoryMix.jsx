import React, { useMemo } from 'react';
import RankedBarChart from './RankedBarChart';
import { categoryMix } from '../aggregations';

/* Export category mix — full labels, no truncation (audit item 9). */
export default function CategoryMix({ apps, loading }) {
  const rows = useMemo(() => categoryMix(apps), [apps]);
  return (
    <RankedBarChart
      title="Category Mix"
      subtitle="Applications by export category, highest first."
      span={6}
      rows={rows}
      loading={loading}
      yWidth={170}
    />
  );
}
