import React, { useEffect, useState } from 'react';
import './DrugComplianceAlert.css';

/* ============================================================
   DrugComplianceAlert
   Presentational only — it performs no lookup and owns no fetch state.
   Feed it the output of useCdscoLookup (or a reviewer's stored flag).

   Props
     severity        'banned' | 'restricted' | 'notFound' | 'approved' | null
     drug            { name, approvalDate?, indication? }
     gazette         { sr, name, notification, status, statusNote?, scope?,
                       totalMatches? } | null
     onAcknowledge   (checked: boolean) => void   — omitted in read-only use
     acknowledged    boolean
     readOnly        boolean  — reviewer dashboard: no checkbox, no actions
     id              string   — target for the input's aria-describedby
   ============================================================ */

/* ---- Icons (inline; the project ships no icon dependency) -------------- */
const ICON = {
  banned: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    </>
  ),
  restricted: (
    <>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  notFound: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
      <line x1="9" y1="9" x2="13" y2="13" />
      <line x1="13" y1="9" x2="9" y2="13" />
    </>
  ),
  approved: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
    </>
  ),
};

function SeverityIcon({ severity }) {
  return (
    <svg
      className="dca-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON[severity] || ICON.notFound}
    </svg>
  );
}

/* Metadata is a flat definition list on wide viewports and a disclosure below
   900px. <details open> is driven from JS because a closed <details> cannot be
   reliably forced open with CSS alone. */
function useIsWide(minWidth = 900) {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(`(min-width: ${minWidth}px)`).matches
      : true
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const onChange = e => setWide(e.matches);
    mq.addEventListener('change', onChange);
    setWide(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, [minWidth]);
  return wide;
}

const STATUS_TEXT = {
  prohibited: 'Prohibited',
  stayed: 'Prohibition stayed by court',
  'sub-judice': 'Quashed by High Court — sub-judice',
  conditional: 'Revoked subject to conditions',
};

/* Short form of a notification for the subline: "GSR 578(E) dated 23.07.1983" */
function shortNotification(notification) {
  return String(notification || '')
    .replace(/G\.?S\.?R\.?\s*(No\.?)?\s*/i, 'GSR ')
    .replace(/S\.?O\.?\s*(No\.?)?\s*/i, 'S.O. ')
    .replace(/\s+/g, ' ')
    .trim();
}

function copyFor(severity, drug, gazette, readOnly) {
  const name = (drug && drug.name) || '';
  switch (severity) {
    case 'banned':
      return {
        headline: `${name} is prohibited under Section 26A`,
        subline: gazette
          ? `Sr. No. ${gazette.sr}, prohibited list · ${shortNotification(gazette.notification)}`
          : '',
        description:
          'This product cannot be exported unless you hold a specific exemption. ' +
          'Attach the exemption order or approval documentation with this application.',
      };
    case 'restricted':
      return {
        headline: `${name} is restricted under Section 26A`,
        subline: gazette
          ? `Sr. No. ${gazette.sr}, prohibited list · ${shortNotification(gazette.notification)}`
          : '',
        description: gazette && gazette.scope
          ? `The prohibition applies to ${gazette.scope}. Confirm your product falls outside that scope and attach the supporting approval.`
          : 'The prohibition on this drug was revoked subject to conditions. Attach the approval documentation showing those conditions are met.',
      };
    case 'notFound':
      return {
        headline: `${name} is not in the CDSCO approved list`,
        subline: 'No matching entry in the CDSCO approved drugs register or the Section 26A prohibited list.',
        description: readOnly
          ? 'The applicant entered a generic name that matches neither register.'
          : 'This product cannot be added until its generic name matches an approved medicine or a ' +
            'Section 26A prohibited entry. Select a name from the lookup suggestions.',
      };
    case 'approved':
      return {
        headline: `${name} is CDSCO approved`,
        subline: drug && drug.approvalDate ? `Approval date: ${drug.approvalDate}` : '',
        description: (drug && drug.indication) || '',
      };
    default:
      return null;
  }
}

export default function DrugComplianceAlert({
  severity,
  drug,
  gazette,
  onAcknowledge,
  acknowledged = false,
  readOnly = false,
  id,
}) {
  const isWide = useIsWide(900);
  if (!severity) return null;

  const copy = copyFor(severity, drug, gazette, readOnly);
  if (!copy) return null;

  const requiresAcknowledgement = severity === 'banned' && !readOnly && typeof onAcknowledge === 'function';
  const showMeta = !!gazette;

  const meta = showMeta && (
    <dl className="dca-meta">
      <div>
        <dt>Sr. No.</dt>
        <dd>{gazette.sr} of 444</dd>
      </div>
      <div>
        <dt>Gazette notification</dt>
        <dd>{gazette.notification}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{STATUS_TEXT[gazette.status] || gazette.status}</dd>
      </div>
    </dl>
  );

  return (
    <div className={`dca sev-${severity}${readOnly ? ' is-readonly' : ''}`} id={id}>
      <SeverityIcon severity={severity} />

      <div className="dca-body">
        <div className="dca-top">
          <div>
            <p className="dca-headline">{copy.headline}</p>
            {copy.subline && <p className="dca-subline">{copy.subline}</p>}
          </div>

          {showMeta && (
            <details className="dca-details" open={isWide}>
              <summary>View notification details</summary>
              {meta}
            </details>
          )}
        </div>

        {copy.description && <p className="dca-desc">{copy.description}</p>}

        {gazette && gazette.statusNote && (
          <p className="dca-note">{gazette.statusNote}</p>
        )}

        {gazette && gazette.totalMatches > 1 && (
          <p className="dca-note">
            Also matches {gazette.totalMatches - 1} other prohibited entr
            {gazette.totalMatches - 1 === 1 ? 'y' : 'ies'} in the list.
          </p>
        )}

        {requiresAcknowledgement && (
          <div className="dca-actions">
            <label className="dca-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={e => onAcknowledge(e.target.checked)}
              />
              <span>I have valid exemption documentation for this drug</span>
            </label>
            {acknowledged && (
              <p className="dca-hint">
                Attach the exemption order at the Documents step so the reviewer can verify it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
