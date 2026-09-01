const ApplicationRead = require('../models/ApplicationRead');

/* ============================================================================
   Read receipts — who has opened what.

   ONE definition of "this reviewer holds a receipt", used by every path that
   asks the question. It used to be written out three times — in the queue
   endpoint, in the read-state endpoint and in the analytics aggregation — and
   the queue's copy omitted the legacy fallback. The KPI strip therefore said
   "10 unread by you" while the table below it showed 11 Unread badges for the
   same reviewer. Anything that needs the predicate must import it from here.

   A receipt matches when either:
     - it is keyed by the reviewer's immutable id (every new write), or
     - it is a legacy row with no reviewerId, keyed by the reviewer's name.

   ---------------------------------------------------------------------------
   Index reconciliation.

   An earlier version of ApplicationRead keyed a receipt by the reviewer's
   NAME and created a unique index on { reviewer, applicationNumber } with no
   partial filter. Receipts are now keyed by the immutable reviewer id, so new
   writes leave `reviewer` unset — and MongoDB indexes a missing field as null.
   The stale index therefore enforces uniqueness on (null, applicationNumber),
   which means at most ONE reviewer in the entire system can hold a receipt for
   any given application. Every other reviewer's "mark as read" fails with
   E11000 and their unread count never moves.

   Mongoose only ever CREATES indexes; it never drops ones it no longer
   declares, so the stale index survives every deploy until something removes
   it explicitly. That is what this does.

   Safe to run repeatedly: it drops only the named legacy index, and only when
   that index is actually unique and unpartitioned (i.e. the broken shape).
   ============================================================================ */

/**
 * Mongo query fragment selecting the receipts held by one reviewer.
 * Use for ApplicationRead.find(...) / countDocuments(...).
 */
function readReceiptQuery(reviewer) {
  return {
    $or: [
      { reviewerId: reviewer.id },
      { reviewerId: { $exists: false }, reviewer: reviewer.name },
    ],
  };
}

/**
 * The same predicate as an aggregation $expr, for use inside a $lookup
 * pipeline where the receipt is joined to an application by number.
 * @param {string} appNoField the let-variable holding the application number
 */
function readReceiptMatchExpression(reviewer, appNoField = '$$appNo') {
  return {
    $and: [
      { $eq: ['$applicationNumber', appNoField] },
      {
        $or: [
          { $eq: ['$reviewerId', reviewer.id] },
          {
            $and: [
              { $eq: [{ $ifNull: ['$reviewerId', null] }, null] },
              { $eq: ['$reviewer', reviewer.name] },
            ],
          },
        ],
      },
    ],
  };
}

const LEGACY_INDEX = 'reviewer_1_applicationNumber_1';

/**
 * Drop the legacy name-keyed unique index if the live database still has it.
 * @returns {Promise<{dropped: boolean, reason: string}>}
 */
async function reconcileReadReceiptIndexes(model = ApplicationRead) {
  const collection = model.collection;
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch (err) {
    /* Collection does not exist yet: nothing to reconcile, and the correct
       index will be built from the schema on first write. */
    if (err.codeName === 'NamespaceNotFound' || /ns does not exist/i.test(err.message || '')) {
      return { dropped: false, reason: 'collection does not exist yet' };
    }
    throw err;
  }

  const legacy = indexes.find(index => index.name === LEGACY_INDEX);
  if (!legacy) return { dropped: false, reason: 'legacy index already absent' };
  if (!legacy.unique) return { dropped: false, reason: 'legacy index is not unique — harmless' };
  if (legacy.partialFilterExpression) {
    return { dropped: false, reason: 'legacy index is partial — cannot collide on null' };
  }

  await collection.dropIndex(LEGACY_INDEX);
  return { dropped: true, reason: 'dropped: it made read receipts unique per application, not per reviewer' };
}

module.exports = {
  readReceiptQuery,
  readReceiptMatchExpression,
  reconcileReadReceiptIndexes,
  LEGACY_INDEX,
};
