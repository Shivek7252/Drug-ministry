import React, { useMemo } from 'react';
import RankedBarChart from './RankedBarChart';
import { stateDistribution } from '../aggregations';

/* Sorted bar rather than a choropleth: no topojson is bundled and adding one
   would breach the dependency budget for a chart of ~10 values. */
export default function StateDistribution({ apps, loading }) {
  const rows = useMemo(() => stateDistribution(apps), [apps]);
  return (
    <RankedBarChart
      title="Applicant State Distribution"
      subtitle="Applications by applicant state. Top 10 shown; the remainder are grouped as Others."
      span={7}
      rows={rows}
      loading={loading}
      yWidth={160}
    />
  );
}
