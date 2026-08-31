import React, { useMemo } from 'react';
import RankedBarChart from './RankedBarChart';
import { destinationCountries } from '../aggregations';

/* Top 8 destinations; everything else folded into "Others". */
export default function DestinationCountries({ apps = [], rows: serverRows = null, loading, error }) {
  const derivedRows = useMemo(() => destinationCountries(apps), [apps]);
  const rows = serverRows || derivedRows;
  return (
    <RankedBarChart
      title="Top Destination Countries"
      subtitle="By declared destination. Top 8 shown; the rest grouped as Others."
      span={6}
      rows={rows}
      loading={loading}
      error={error}
      height={320}
      yWidth={140}
    />
  );
}
