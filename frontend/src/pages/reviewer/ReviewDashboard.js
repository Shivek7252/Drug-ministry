import React, { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { reviewerAction } from '../../api/applicationService';

import useReviewQueue, { isUnread } from '../../hooks/useReviewQueue';
import useReviewerAnalytics from '../../hooks/useReviewerAnalytics';
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
  /* KPI comparisons come from the server: it can see the full filtered set and
     the transition history, neither of which this client has. Same filters as
     the table, so both describe the same population. */
  const analytics = useReviewerAnalytics({
    ...q.serverFilters,
    workflowStatus: q.kpiFilter,
  });

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
    analytics.reload();
    const search = searchParams.toString();
    navigate(`/review/application/${app.applicationNumber}${search ? `?${search}` : ''}`);
  }, [navigate, q, analytics, searchParams]);

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
    analytics.reload();
  }, [q, analytics]);

  const chartData = analytics.analytics?.charts || null;
  const analyticsLoading = analytics.loading && !chartData;
  const analyticsError = !chartData ? analytics.error : '';

  const charts = (
    <>
      <SubmissionTrend series={chartData?.submissionTrend} loading={analyticsLoading} error={analyticsError} />
      <StatusDonut
        rows={chartData?.statusDistribution}
        loading={analyticsLoading}
        error={analyticsError}
        onSelectStatus={status => q.setKpiFilter(tileForStatus(status))}
      />
      <ProcessingTime data={chartData?.processingTime} loading={analyticsLoading} error={analyticsError} />
      <CategoryMix rows={chartData?.categoryMix} loading={analyticsLoading} error={analyticsError} />
      <DestinationCountries rows={chartData?.destinationCountries} loading={analyticsLoading} error={analyticsError} />
      <PipelineFunnel data={chartData?.pipeline} loading={analyticsLoading} error={analyticsError} />
      <DecisionThroughput rows={chartData?.decisionThroughput} loading={analyticsLoading} error={analyticsError} />
    </>
  );

  return (
    <div className="rvd">
      <DashboardHeader officer={currentUser || 'Reviewer'} />

      <main className="rvd-main" id="main-content" tabIndex={-1}>
        <div className="rvd-wrap">
          <KpiFilterRow
            tiles={q.tiles}
            counts={analytics.serverCounts}
            deltas={analytics.comparison}
            analytics={analytics}
            value={q.kpiFilter}
            onChange={q.setKpiFilter}
            loading={analytics.loading && !analytics.analytics}
            unavailable={!analytics.analytics}
            unreadCount={analytics.unread?.count}
            readStateReady={Boolean(analytics.analytics)}
            unknownCount={analytics.analytics?.unknownCount || 0}
          />

          <AnalyticsPanel
            truncated={false}
            loading={analyticsLoading}
            resultCount={chartData?.scope?.applications || 0}
            filtered={q.hasFilters}
            stale={analytics.stale}
            error={analytics.error}
            generatedAt={analytics.generatedAt}
          >
            {charts}
          </AnalyticsPanel>
        </div>

        <FilterBar
          searchQ={q.searchQ} onSearch={q.setSearchQ}
          filterCat={q.filterCat} onCategory={q.setFilterCat} categories={q.categories}
          country={q.country} onCountry={q.setCountry}
          state={q.state} onState={q.setState} states={q.states}
          datePreset={q.datePreset} onDatePreset={q.setDatePreset}
          startDate={q.startDate} onStartDate={q.setStartDate}
          endDate={q.endDate} onEndDate={q.setEndDate}
          hasFilters={q.hasFilters} onClearAll={q.resetFilters}
          resultCount={q.totalRows} loading={q.loading}
        />

        <div className="rvd-wrap">
          <ReviewQueueTable
            rows={q.pageRows}
            loading={q.loading}
            refreshing={q.refreshing}
            stale={q.stale}
            error={q.error}
            hasFilters={q.hasFilters}
            onRetry={() => q.reload()}
            sort={q.sort} onSort={q.toggleSort}
            page={q.page} pageCount={q.pageCount} onPage={q.setPage}
            rowsPerPage={q.rowsPerPage} onRowsPerPage={q.setRowsPerPage}
            totalRows={q.totalRows}
            selected={q.selected}
            onToggleSelect={q.toggleSelect}
            onToggleSelectAll={q.toggleSelectAllOnPage}
            onClearSelection={q.clearSelection}
            density={density} onDensity={setDensity}
            onOpen={openApplication}
            isUnread={app => isUnread(app, q.readSet)}
            onBulkMarkInReview={bulkMarkInReview}
            bulkBusy={bulkBusy}
          />
        </div>
      </main>
    </div>
  );
}
