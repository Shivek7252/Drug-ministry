import React, { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { reviewerAction } from '../../api/applicationService';

import useReviewQueue, { isNewUnseen } from '../../hooks/useReviewQueue';
import { tileForStatus } from './dashboard/aggregations';

import DashboardHeader from './dashboard/DashboardHeader';
import KpiFilterRow from './dashboard/KpiFilterRow';
import AnalyticsPanel from './dashboard/AnalyticsPanel';
import FilterBar from './dashboard/FilterBar';
import ReviewQueueTable from './dashboard/ReviewQueueTable';

import SubmissionTrend from './dashboard/charts/SubmissionTrend';
import StatusDonut from './dashboard/charts/StatusDonut';
import ProcessingTime from './dashboard/charts/ProcessingTime';
import CategoryMix from './dashboard/charts/CategoryMix';
import DestinationCountries from './dashboard/charts/DestinationCountries';
import StateDistribution from './dashboard/charts/StateDistribution';
import PipelineFunnel from './dashboard/charts/PipelineFunnel';
import DecisionThroughput from './dashboard/charts/DecisionThroughput';

import '../../styles/tokens.css';
import './dashboard/dashboardChrome.css';
import './dashboard/AnalyticsPanel.css';
import './dashboard/reviewQueueTable.css';
import './ReviewDashboard.css';

/* ============================================================================
   ReviewDashboard — composition shell.

   All state lives in useReviewQueue; all derivation lives in aggregations.js;
   all presentation lives in the components below. This file only wires them
   together and owns two pieces of pure view state (density, bulk-busy).
   ============================================================================ */

const DENSITY_KEY = 'reviewer_table_density';

export default function ReviewDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentUser } = useApp();
  const q = useReviewQueue();

  const [density, setDensityState] = useState(() => {
    try { return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'; }
    catch { return 'comfortable'; }
  });
  const setDensity = useCallback(value => {
    setDensityState(value);
    try { localStorage.setItem(DENSITY_KEY, value); } catch { /* private mode */ }
  }, []);

  const [bulkBusy, setBulkBusy] = useState(false);

  const openApplication = useCallback(app => {
    q.markOpened(app.applicationNumber);
    const search = searchParams.toString();
    navigate(`/review/application/${app.applicationNumber}${search ? `?${search}` : ''}`);
  }, [navigate, q, searchParams]);

  /* The only bulk action with a backing endpoint. Loops the existing
     per-application route; no API change. */
  const bulkMarkInReview = useCallback(async () => {
    setBulkBusy(true);
    await Promise.all([...q.selected].map(appNo =>
      reviewerAction(appNo, { status: 'Under Review', remarks: 'Marked in review from the queue' })
        .catch(() => null)
    ));
    q.clearSelection();
    setBulkBusy(false);
    q.reload();
  }, [q]);

  const charts = (
    <>
      <SubmissionTrend apps={q.viewFiltered} loading={q.loading} />
      <StatusDonut
        apps={q.viewFiltered}
        loading={q.loading}
        onSelectStatus={status => q.setKpiFilter(tileForStatus(status))}
      />
      <ProcessingTime apps={q.viewFiltered} loading={q.loading} />
      <CategoryMix apps={q.viewFiltered} loading={q.loading} />
      <DestinationCountries apps={q.viewFiltered} loading={q.loading} />
      <StateDistribution apps={q.viewFiltered} loading={q.loading} />
      <PipelineFunnel apps={q.viewFiltered} loading={q.loading} />
      <DecisionThroughput apps={q.viewFiltered} loading={q.loading} />
    </>
  );

  return (
    <div className="rvd">
      <DashboardHeader officer={currentUser || 'Reviewer'} />

      <main className="rvd-main" id="main-content" tabIndex={-1}>
        <div className="rvd-wrap">
          <KpiFilterRow
            tiles={q.tiles}
            counts={q.counts}
            deltas={q.deltas}
            value={q.kpiFilter}
            onChange={q.setKpiFilter}
            loading={q.loading}
          />

          <AnalyticsPanel
            truncated={q.truncated}
            loading={q.loading}
            resultCount={q.viewFiltered.length}
            filtered={q.hasFilters}
          >
            {charts}
          </AnalyticsPanel>
        </div>

        <FilterBar
          searchQ={q.searchQ} onSearch={q.setSearchQ}
          filterCat={q.filterCat} onCategory={q.setFilterCat} categories={q.categories}
          country={q.country} onCountry={q.setCountry} countries={q.countries}
          datePreset={q.datePreset} onDatePreset={q.setDatePreset}
          startDate={q.startDate} onStartDate={q.setStartDate}
          endDate={q.endDate} onEndDate={q.setEndDate}
          hasFilters={q.hasFilters} onClearAll={q.resetFilters}
          resultCount={q.viewFiltered.length} loading={q.loading}
        />

        <div className="rvd-wrap">
          <ReviewQueueTable
            rows={q.pageRows}
            loading={q.loading}
            error={q.error}
            sort={q.sort} onSort={q.toggleSort}
            page={q.page} pageCount={q.pageCount} onPage={q.setPage}
            rowsPerPage={q.rowsPerPage} onRowsPerPage={q.setRowsPerPage}
            totalRows={q.sortedRows.length}
            selected={q.selected}
            onToggleSelect={q.toggleSelect}
            onToggleSelectAll={q.toggleSelectAllOnPage}
            onClearSelection={q.clearSelection}
            density={density} onDensity={setDensity}
            onOpen={openApplication}
            openedApps={q.openedApps}
            isUnseen={app => isNewUnseen(app, q.openedApps)}
            onBulkMarkInReview={bulkMarkInReview}
            bulkBusy={bulkBusy}
          />
        </div>
      </main>
    </div>
  );
}
