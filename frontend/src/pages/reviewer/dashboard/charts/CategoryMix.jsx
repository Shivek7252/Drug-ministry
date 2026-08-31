import React, { useMemo } from 'react';
import RankedBarChart from './RankedBarChart';
import { categoryMix } from '../aggregations';

/* Export category mix — full labels, no truncation (audit item 9). */
export default function CategoryMix({ apps = [], rows: serverRows = null, loading, error }) {
  const derivedRows = useMemo(() => categoryMix(apps), [apps]);
  const rows = serverRows || derivedRows;
  return (
    <RankedBarChart
      title="Category Mix"
      subtitle="Applications by export category, highest first."
      span={6}
      rows={rows}
      loading={loading}
      error={error}
      height={320}
      yWidth={170}
    />
  );
}
