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

describe('ReviewDashboard uses authoritative server analytics', () => {
  test('KPI cards and unread use the analytics response with no client fallback', () => {
    expect(dashboard).toMatch(/counts=\{analytics\.serverCounts\}/);
    expect(dashboard).toMatch(/unreadCount=\{analytics\.unread\?\.count\}/);
    expect(dashboard).toMatch(/deltas=\{analytics\.comparison\}/);
    expect(dashboard).not.toMatch(/q\.counts|q\.deltas|q\.unreadCount/);
  });

  test('all charts receive server aggregation data, never paginated queue rows', () => {
    expect(dashboard).toMatch(/chartData\?\.submissionTrend/);
    expect(dashboard).toMatch(/chartData\?\.decisionThroughput/);
    expect(dashboard).not.toMatch(/apps=\{q\.(viewFiltered|barFiltered|pageRows)/);
    expect(queueHook).not.toMatch(/MAX_PAGES|SERVER_PAGE_SIZE/);
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
