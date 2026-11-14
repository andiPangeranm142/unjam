// Plan orchestration for Unjam (CONCEPT.md section 5.3).
// Combines the chain trace, candidate gathering, scoring and drafts into
// the two answers the surfaces need: one issue's unblock plan, and a
// project's blocked-work board. Never invents data: every unreadable source
// is recorded in `notes`.

import { blockerKeysOf, traceBlockers } from './chain.js';
import { buildCandidates } from './candidates.js';
import { daysBetween, scoreBlockCost, scoreUnblocker } from './scoring.js';
import { buildDraft } from './draft.js';

// Cap on extra getIssue calls while resolving blocker details in
// buildProjectBlocks (CONCEPT.md section 5.3).
const MAX_BLOCKER_FETCHES = 25;

// Whole days an issue has been open (0 when the creation date is unknown).
function ageOf(issue, now) {
  return issue?.created ? Math.max(0, daysBetween(issue.created, now)) : 0;
}

export function dueStatusFor(duedate, now) {
  if (!duedate) return 'none';
  const days = daysBetween(now, duedate);
  if (days < 0) return 'overdue';
  if (days <= 7) return 'dueSoon7';
  if (days <= 30) return 'dueSoon30';
  return 'none';
}

export async function buildUnblockPlan({ jira, twg }, issueKey, { cloudId = null, now = new Date() } = {}) {
  const notes = [];
  const issue = await jira.getIssue(issueKey);
  const { chain, notes: chainNotes } = await traceBlockers(jira, issueKey);
  notes.push(...chainNotes);

  const openBlockers = chain.filter((n) => n.statusCategory !== 'done');
  const generatedAt = new Date(now).toISOString();

  if (openBlockers.length === 0) {
    notes.push('This issue is not blocked by any open issue.');
    return {
      issue,
      isBlocked: false,
      chain,
      openBlockers: [],
      unblockers: [],
      cost: null,
      draft: null,
      tracking: null, // tracking is not read here; the resolver/action fills it in
      notes,
      generatedAt,
    };
  }

  const { candidates, notes: candidateNotes } = await buildCandidates(
    { jira, twg },
    { issue, chain, cloudId },
    { now },
  );
  notes.push(...candidateNotes);

  const unblockers = candidates
    .map((candidate) => ({ ...candidate, ...scoreUnblocker(candidate) }))
    .sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName));

  // Cost is computed from the most expensive open blocker: oldest first,
  // then the one with the most issues waiting.
  const sortedBlockers = [...openBlockers].sort(
    (a, b) => ageOf(b, now) - ageOf(a, now) || (b.waitingCount ?? -1) - (a.waitingCount ?? -1),
  );
  const costBlocker = sortedBlockers[0];
  const ageDays = ageOf(costBlocker, now);
  if (costBlocker.waitingCount === null || costBlocker.waitingCount === undefined) {
    notes.push(`Waiting count for ${costBlocker.key} could not be read; cost assumes 1 issue waiting.`);
  }
  const cost = scoreBlockCost({
    ageDays,
    waitingCount: costBlocker.waitingCount ?? null,
    dueStatus: dueStatusFor(issue.duedate, now),
    priority: issue.priority,
  });

  // Draft for the top-ranked unblocker and the nearest open blocker (depth 1).
  let draft = null;
  if (unblockers.length > 0) {
    const nearest =
      openBlockers
        .filter((b) => b.depth === 1)
        .sort((a, b) => (b.waitingCount ?? -1) - (a.waitingCount ?? -1))[0] ?? openBlockers[0];
    draft = buildDraft({
      waitingIssue: issue,
      blocker: nearest,
      unblocker: unblockers[0],
      cost,
      ageDays: ageOf(nearest, now),
      waitingCount: nearest.waitingCount ?? null,
    });
  } else {
    notes.push('No unblocker candidates could be found, so no draft was created.');
  }

  return {
    issue,
    isBlocked: true,
    chain,
    openBlockers,
    unblockers,
    cost,
    draft,
    tracking: null, // tracking is not read here; the resolver/action fills it in
    notes,
    generatedAt,
  };
}

export async function buildProjectBlocks({ jira }, projectKey, { now = new Date(), maxIssues = 100 } = {}) {
  const notes = [];
  const { issues, truncated } = await jira.searchProjectOpenIssues(projectKey, { maxResults: maxIssues });
  if (truncated) {
    notes.push(`Project scan truncated at ${maxIssues} open issues; some blocked work may be missing.`);
  }

  const byKey = new Map(issues.map((i) => [i.key, i]));

  // Waiting counts per blocker, computed from the fetched issues (not JQL).
  const waitingCountByBlocker = new Map();
  const blockedIssues = issues.filter((i) => blockerKeysOf(i).length > 0);
  for (const issue of blockedIssues) {
    for (const blockerKey of new Set(blockerKeysOf(issue))) {
      waitingCountByBlocker.set(blockerKey, (waitingCountByBlocker.get(blockerKey) ?? 0) + 1);
    }
  }

  // Resolve blocker details: blockers inside the fetched open set are known
  // open; anything else needs a getIssue (done blockers, cross-project
  // blockers), capped at 25 fetches. Unresolvable blockers are skipped
  // rather than guessed.
  const blockerCache = new Map(); // key -> Issue | null (unknown)
  let fetches = 0;
  const resolveBlocker = async (key) => {
    if (byKey.has(key)) return byKey.get(key);
    if (blockerCache.has(key)) return blockerCache.get(key);
    if (fetches >= MAX_BLOCKER_FETCHES) {
      blockerCache.set(key, null);
      return null;
    }
    fetches += 1;
    try {
      const blocker = await jira.getIssue(key);
      blockerCache.set(key, blocker);
      return blocker;
    } catch (err) {
      notes.push(`Blocker ${key} could not be read: ${err?.message ?? 'unknown error'}`);
      blockerCache.set(key, null);
      return null;
    }
  };

  const blocks = [];
  for (const issue of blockedIssues) {
    for (const blockerKey of [...new Set(blockerKeysOf(issue))]) {
      const blocker = await resolveBlocker(blockerKey);
      if (!blocker) continue;
      if (blocker.statusCategory === 'done') continue;
      const ageDays = ageOf(blocker, now);
      const waitingCount = waitingCountByBlocker.get(blockerKey) ?? 1;
      const cost = scoreBlockCost({
        ageDays,
        waitingCount,
        dueStatus: dueStatusFor(issue.duedate, now),
        priority: issue.priority,
      });
      blocks.push({
        issue,
        blocker,
        // Top unblocker without TWG per row (keeps the board fast):
        // the nearest blocker's assignee, or null when unassigned.
        topUnblocker: blocker.assignee ?? null,
        cost,
        ageDays,
        waitingCount,
      });
    }
  }
  if (fetches >= MAX_BLOCKER_FETCHES) {
    notes.push('Blocker detail lookups capped at 25; some blockers were not checked.');
  }

  blocks.sort((a, b) => b.cost.total - a.cost.total);

  return {
    projectKey,
    blocks,
    totalOpen: issues.length,
    blockedCount: blocks.length,
    notes,
    generatedAt: new Date(now).toISOString(),
  };
}
