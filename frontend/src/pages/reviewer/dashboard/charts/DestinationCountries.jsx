import React, { useMemo } from 'react';
import RankedBarChart from './RankedBarChart';
import { destinationCountries } from '../aggregations';

/* Top 8 destinations; everything else folded into "Others". */
export default function DestinationCountries({ apps, loading }) {
  const rows = useMemo(() => destinationCountries(apps), [apps]);
  return (
    <RankedBarChart
      title="Top Destination Countries"
      subtitle="Applications by declared destination. Top 8 shown; the remainder are grouped as Others."
      span={5}
      rows={rows}
      loading={loading}
      yWidth={130}
    />
  );
}
