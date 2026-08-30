import { useEffect, useRef, useState } from 'react';
import { loadApprovedDrugs, findApprovedDrug } from '../data/approvedDrugs';
import { loadBannedDrugs, checkBannedDrug } from '../data/bannedDrugs';

/* ============================================================
   useCdscoLookup(genericName)

   Owns the whole lookup lifecycle for one drug name:
     - 300ms debounce on the typed name
     - AbortController per run, so a superseded lookup can never commit state
     - cache keyed by the normalised name
     - severity resolution (single winner, highest severity)

   Severity precedence — exactly one is ever returned:
     banned      Section 26A prohibition in force for the whole product
     restricted  prohibition is partial (a named scope) or was revoked
                 subject to conditions, or is currently stayed by a court
     notFound    no entry in the CDSCO approved register
     approved    listed in the CDSCO approved register, no 26A match

   The HTTP contract of /api/approved-drugs and /api/banned-drugs is untouched;
   both lists are loaded once by their data modules and matched in memory.
   ============================================================ */

export const DEBOUNCE_MS = 300;
const MIN_LENGTH = 3;

/* Restricted rather than outright banned: the gazette entry limits the ban to a
   named scope, or the prohibition is not presently in force against the drug. */
const RESTRICTED_STATUSES = ['conditional', 'stayed'];

function normaliseKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function resolveSeverity(genericName) {
  const banned = checkBannedDrug(genericName, 8);
  const approved = findApprovedDrug(genericName);

  if (banned.banned && banned.primary) {
    // An outright prohibition anywhere in the match set outranks a scoped one,
    // even when the scoped entry scored higher.
    const isPartial = m => !!m.scope || RESTRICTED_STATUSES.includes(m.status);
    const absolute = banned.matches.find(m => !isPartial(m));
    const p = absolute || banned.primary;
    return {
      severity: absolute ? 'banned' : 'restricted',
      drug: {
        name: String(genericName).trim(),
        approvalDate: approved ? approved.approvalDate : '',
        indication: approved ? approved.indication : '',
      },
      gazette: {
        sr: p.sr,
        name: p.name,
        notification: p.notification,
        status: p.status,
        statusNote: p.statusNote,
        scope: p.scope,
        matchType: p.matchType,
        totalMatches: banned.totalMatches,
      },
    };
  }

  if (approved) {
    return {
      severity: 'approved',
      drug: {
        name: approved.genericName,
        approvalDate: approved.approvalDate,
        indication: approved.indication,
      },
      gazette: null,
    };
  }

  return {
    severity: 'notFound',
    drug: { name: String(genericName).trim(), approvalDate: '', indication: '' },
    gazette: null,
  };
}

/* Cache lives for the session; both source lists are static per deployment. */
const cache = new Map();

export default function useCdscoLookup(genericName) {
  const [state, setState] = useState({ status: 'idle', severity: null, drug: null, gazette: null });
  const abortRef = useRef(null);
  const alertId = useRef(`dca-${Math.random().toString(36).slice(2, 9)}`).current;

  useEffect(() => {
    const raw = String(genericName || '').trim();

    // Cancel whatever the previous keystroke started.
    if (abortRef.current) abortRef.current.abort();

    if (raw.length < MIN_LENGTH) {
      setState({ status: 'idle', severity: null, drug: null, gazette: null });
      return undefined;
    }

    const key = normaliseKey(raw);
    if (cache.has(key)) {
      const hit = cache.get(key);
      setState({ ...hit, status: hit.severity === 'approved' ? 'matched' : 'flagged' });
      return undefined;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setState(s => ({ ...s, status: 'checking' }));

    const timer = setTimeout(() => {
      Promise.all([loadApprovedDrugs(), loadBannedDrugs()])
        .then(() => {
          // A newer keystroke aborted this run — drop the stale result.
          if (signal.aborted) return;
          const resolved = resolveSeverity(raw);
          cache.set(key, resolved);
          setState({
            ...resolved,
            status: resolved.severity === 'approved' ? 'matched' : 'flagged',
          });
        })
        .catch(() => {
          if (signal.aborted) return;
          setState({ status: 'idle', severity: null, drug: null, gazette: null });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [genericName]);

  return {
    ...state,
    alertId,
    // Only an outright prohibition needs the applicant to acknowledge exemption.
    requiresAcknowledgement: state.severity === 'banned',
  };
}
