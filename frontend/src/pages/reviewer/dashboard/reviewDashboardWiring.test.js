import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AnalyticsPanel from './AnalyticsPanel';
import {
  canonicalReviewerFilters, serializeReviewerFilters,
} from '../../../config/reviewerFilters';

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'ReviewDashboard.js'), 'utf8');
const queueHook = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'hooks', 'useReviewQueue.js'), 'utf8');

const appPage = fs.readFileSync(path.join(__dirname, '..', 'ReviewApplicationPage.js'), 'utf8');

describe('ReviewDashboard uses authoritative server analytics', () => {
  test('KPI cards and unread use the analytics response with no client fallback', () => {
    expect(dashboard).toMatch(/counts=\{analytics\.serverCounts\}/);
    expect(dashboard).toMatch(/unreadCount=\{analytics\.unread\?\.count\}/);
    expect(dashboard).not.toMatch(/q\.counts|q\.deltas|q\.unreadCount/);
  });

  test('no week-to-date comparison is passed to the KPI cards any more', () => {
    expect(dashboard).not.toMatch(/deltas=/);
    expect(dashboard).not.toMatch(/comparison/);
  });

  test('the analytics hook no longer exposes a comparison for the cards to read', () => {
    const hook = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'hooks', 'useReviewerAnalytics.js'), 'utf8');
    expect(hook).not.toMatch(/comparison/);
  });

  test('all charts receive server aggregation data, never paginated queue rows', () => {
    expect(dashboard).toMatch(/chartData\?\.submissionTrend/);
    expect(dashboard).toMatch(/chartData\?\.decisionThroughput/);
    expect(dashboard).not.toMatch(/apps=\{q\.(viewFiltered|barFiltered|pageRows)/);
    expect(queueHook).not.toMatch(/MAX_PAGES|SERVER_PAGE_SIZE/);
  });
});

/* ---- Unread is server state, refreshed rather than decremented ----------- */

describe('unread never becomes a local number', () => {
  test('the dashboard renders the server count and nothing derived from rows', () => {
    expect(dashboard).toMatch(/unreadCount=\{analytics\.unread\?\.count\}/);
    /* No arithmetic on the displayed count anywhere in the reviewer surface. */
    for (const source of [dashboard, appPage]) {
      expect(source).not.toMatch(/unread\s*-\s*1|unreadCount\s*-{1,2}|setUnread/i);
    }
  });

  test('read state never falls back to localStorage', () => {
    const queueHook = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'hooks', 'useReviewQueue.js'), 'utf8');
    for (const source of [dashboard, appPage, queueHook]) {
      expect(source).not.toMatch(/reviewer_opened_apps/);
      expect(source).not.toMatch(/localStorage[\s\S]{0,40}read/i);
    }
  });

  test('opening from the queue returns the receipt promise instead of racing a refetch', () => {
    /* The old handler fired analytics.reload() alongside an un-awaited
       markOpened, so the count was refetched before the receipt landed. */
    expect(dashboard).toMatch(/return q\.markOpened\(app\.applicationNumber\)/);
    const opener = dashboard.slice(
      dashboard.indexOf('const openApplication'),
      dashboard.indexOf('const chartData'),
    );
    expect(opener).not.toMatch(/analytics\.reload\(\)/);
  });

  test('the application page marks read after the application loads', () => {
    expect(appPage).toMatch(/markApplicationRead/);
    expect(appPage).toMatch(/signalQueueChanged/);
    /* Keyed on the loaded application, not the raw URL segment. */
    expect(appPage).toMatch(/full\?\.applicationNumber/);
  });
});

describe('canonical filter serialization', () => {
  test('search, state and every global filter serialize once under canonical names', () => {
    const params = serializeReviewerFilters({
      q: 'EXP-1', state: 'Kerala', category: 'Vaccines', country: 'Japan',
      datePreset: 'custom', startDate: '2026-01-01', endDate: '2026-01-31',
      workflowStatus: 'approved',
    });
    expect(params.get('search')).toBe('EXP-1');
    expect(params.has('q')).toBe(false);
    for (const key of ['state', 'category', 'country', 'datePreset', 'startDate', 'endDate', 'workflowStatus']) {
      expect(params.has(key)).toBe(true);
    }
  });

  test('canonical defaults are explicit and stable', () => {
    expect(canonicalReviewerFilters()).toEqual(expect.objectContaining({
      search: '', state: 'All States', status: 'All', workflowStatus: 'total', datePreset: 'all',
    }));
  });
});

test('stale analytics names the last successful generation time', () => {
  render(
    <AnalyticsPanel stale error="HTTP 500" generatedAt="2026-08-31T02:30:00.000Z">
      <div>chart</div>
    </AnalyticsPanel>,
  );
  expect(screen.getByText(/last successful analytics snapshot/i)).toBeInTheDocument();
  expect(screen.getByText(/Generated/i).closest('.ap-stale').querySelector('time'))
    .toHaveAttribute('dateTime', '2026-08-31T02:30:00.000Z');
});
