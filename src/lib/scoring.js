// Pure scoring functions for Unjam (CONCEPT.md section 5.3).
// No I/O, no hidden "now": every date calculation takes explicit inputs.

export const WEIGHTS = {
  ownership: 35,
  expertise: 25,
  availability: 20,
  familiarity: 10,
  team: 10,
};

// Whole days between two dates (a -> b). Accepts Date objects or date strings.
// Negative when b is before a.
export function daysBetween(a, b) {
  const start = a instanceof Date ? a : new Date(a);
  const end = b instanceof Date ? b : new Date(b);
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function clampSignal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Score one unblocker candidate (0-100).
// Each raw signal value (0-100) contributes value/100 * weight points.
// Reasons are passed through from the candidate (built by candidates.js
// from the same signals); an empty array when none were recorded.
export function scoreUnblocker(candidate) {
  const signals = candidate?.signals ?? {};
  const breakdown = {};
  let sum = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const points = round1((clampSignal(signals[key]?.value) / 100) * weight);
    breakdown[key] = points;
    sum += points;
  }
  return {
    total: Math.round(sum),
    breakdown,
    reasons: [...(candidate?.reasons ?? [])],
  };
}

// Score the cost of a block (0-100) with a human-readable label.
//   ageDays: days the blocker has been open.
//   waitingCount: issues waiting on the blocker (null = unknown, assumed 1).
//   dueStatus: 'overdue' | 'dueSoon7' | 'dueSoon30' | 'none' (computed by plan.js).
//   priority: Jira priority name of the waiting issue (or null).
export function scoreBlockCost({ ageDays = 0, waitingCount = null, dueStatus = 'none', priority = null } = {}) {
  const age = ageDays <= 2 ? 5 : ageDays <= 7 ? 15 : ageDays <= 14 ? 25 : ageDays <= 30 ? 33 : 40;

  let waiting;
  if (waitingCount === null || waitingCount === undefined) {
    waiting = 8; // unknown: assume 1 issue waiting (plan.js records a note)
  } else if (waitingCount <= 0) {
    waiting = 0;
  } else if (waitingCount === 1) {
    waiting = 8;
  } else if (waitingCount <= 3) {
    waiting = 16;
  } else if (waitingCount <= 6) {
    waiting = 23;
  } else {
    waiting = 30;
  }

  const deadline =
    dueStatus === 'overdue' ? 20 : dueStatus === 'dueSoon7' ? 14 : dueStatus === 'dueSoon30' ? 7 : 0;

  const p = String(priority ?? '').toLowerCase();
  const priorityPoints =
    p === 'highest' ? 10 : p === 'high' ? 7 : p === 'medium' ? 4 : p === 'low' || p === 'lowest' ? 1 : 3;

  const total = age + waiting + deadline + priorityPoints;
  const label = total < 25 ? 'Low' : total < 50 ? 'Medium' : total < 75 ? 'High' : 'Critical';

  const reasons = [];
  reasons.push(`Blocked for ${ageDays} day${ageDays === 1 ? '' : 's'}`);
  if (waitingCount === null || waitingCount === undefined) {
    reasons.push('Waiting count unknown (assumed 1 issue waiting)');
  } else if (waitingCount > 0) {
    reasons.push(`${waitingCount} issue${waitingCount === 1 ? '' : 's'} waiting on this blocker`);
  }
  if (dueStatus === 'overdue') reasons.push('Past its due date');
  else if (dueStatus === 'dueSoon7') reasons.push('Due within 7 days');
  else if (dueStatus === 'dueSoon30') reasons.push('Due within 30 days');
  reasons.push(priority ? `Priority: ${priority}` : 'No priority set');

  return {
    total,
    label,
    breakdown: { age, waiting, deadline, priority: priorityPoints },
    reasons,
  };
}
