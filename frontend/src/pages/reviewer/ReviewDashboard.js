import React, { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

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
   together.
   ============================================================================ */

export default function ReviewDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentUser } = useApp();
  const q = useReviewQueue();
  /* KPI counts and the reviewer's unread total come from the server: it can
     see the complete filtered set, which this client cannot — it only ever
     holds the page it fetched. Same filters as the table, so both describe the
     same population. */
  const analytics = useReviewerAnalytics({
    ...q.serverFilters,
    workflowStatus: q.kpiFilter,
  });

  /* Navigate first so the click feels instant, then persist the read receipt.
     markOpened signals the queue changed once the POST succeeds, which is what
     refreshes the unread count — the count is never decremented locally, and
     the refresh is never fired before the receipt it is meant to observe. */
  const openApplication = useCallback(app => {
    const search = searchParams.toString();
    navigate(`/review/application/${app.applicationNumber}${search ? `?${search}` : ''}`);
    return q.markOpened(app.applicationNumber);
  }, [navigate, q, searchParams]);

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
            onOpen={openApplication}
            isUnread={app => isUnread(app, q.readSet)}
          />
        </div>
      </main>
    </div>
  );
}
