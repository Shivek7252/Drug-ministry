export const DATE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

export const DEFAULT_REVIEWER_FILTERS = Object.freeze({
  search: '', category: 'All', country: 'All', state: 'All States',
  status: 'All', workflowStatus: 'total', datePreset: 'all',
  startDate: '', endDate: '',
});

export function canonicalReviewerFilters(input = {}) {
  return {
    search: String(input.search ?? input.q ?? '').trim(),
    category: input.category || DEFAULT_REVIEWER_FILTERS.category,
    country: input.country || DEFAULT_REVIEWER_FILTERS.country,
    state: input.state || DEFAULT_REVIEWER_FILTERS.state,
    status: input.status || DEFAULT_REVIEWER_FILTERS.status,
    workflowStatus: input.workflowStatus || DEFAULT_REVIEWER_FILTERS.workflowStatus,
    datePreset: input.datePreset || DEFAULT_REVIEWER_FILTERS.datePreset,
    startDate: input.startDate || '',
    endDate: input.endDate || '',
  };
}

/** The only reviewer-filter serializer used by queue, analytics and export. */
export function serializeReviewerFilters(input = {}, extras = {}) {
  const filters = canonicalReviewerFilters(input);
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  Object.entries(extras).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params;
}
