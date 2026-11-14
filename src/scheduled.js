// Daily watch (scheduledTrigger, runs as the APP).
//
// For every tracked unblock request:
//  - Blocker Done, waiting issue Done, or the "is blocked by" link gone
//    -> post a "cleared" comment to the WAITING issue and clear tracking.
//       A failed comment still clears the record (the block is gone either
//       way); the failure is only visible in the summary error count.
//  - Still blocked, past SLA (requestedAt + slaHours), not yet escalated
//    -> post the escalation draft to the BLOCKER issue and mark escalated.
//       The record is marked escalated only AFTER the comment posts, so a
//       failed post is retried on the next run instead of being lost.
//  - Still blocked, within SLA, or already escalated -> skip (one escalation
//    per request in v1).
//
// NEVER calls Teamwork Graph here: scheduled triggers run asApp, and
// requestTeamworkGraph does not exist on asApp. NEVER throws out of run():
// per-record errors are counted and the run continues; a failure in
// listTracked itself returns a zero-checked summary with errors: 1.
import { kvs } from '@forge/kvs';
import { buildEscalationDraft } from './lib/draft.js';
import { asAppJira } from './lib/forge-clients.js';
import { clearTracked, listTracked, markEscalated, SLA_HOURS } from './lib/tracking.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// Is the waiting issue still linked to this blocker via "is blocked by"?
// Normalized issueLinks (see JiraClient): a blocker link from this issue's
// point of view is { type: 'Blocks', direction: 'inward' }.
function isBlockedBy(waitingIssue, blockerKey) {
  return (waitingIssue.issueLinks ?? []).some(
    (link) =>
      link.direction === 'inward' &&
      String(link.type).toLowerCase() === 'blocks' &&
      link.linkedKey === blockerKey,
  );
}

function clearedCommentAdf(record, { blockerDone, waitingDone, blockerGone }) {
  let text;
  if (waitingDone) {
    text =
      `Unjam: ${record.issueKey} is done, so the unblock request about ` +
      `${record.blockerKey} has been closed. No further follow-up is needed.`;
  } else if (blockerDone && !blockerGone) {
    text =
      `Unjam: good news — ${record.blockerKey} is done, so this issue is no ` +
      'longer blocked. The unblock request has been closed.';
  } else {
    text =
      `Unjam: this issue is no longer blocked by ${record.blockerKey}, so the ` +
      'unblock request has been closed.';
  }
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

// Process one tracking record. Returns 'cleared' | 'escalated' | 'skipped'.
// Throws only for unexpected failures (counted by the caller); a 404 on
// either issue means the issue was deleted, which counts as cleared.
async function processRecord(jira, record, now) {
  const { issueKey, blockerKey } = record;

  let blocker = null;
  let waiting = null;
  let blockerGone = false;
  let waitingGone = false;
  try {
    blocker = await jira.getIssue(blockerKey);
  } catch (err) {
    if (err?.status === 404) {
      blockerGone = true;
    } else {
      throw err;
    }
  }
  try {
    waiting = await jira.getIssue(issueKey);
  } catch (err) {
    if (err?.status === 404) {
      waitingGone = true;
    } else {
      throw err;
    }
  }

  // The waiting issue itself is gone: nothing to notify, just clear.
  if (waitingGone) {
    await clearTracked(kvs, issueKey);
    return 'cleared';
  }

  const blockerDone = blockerGone || blocker?.statusCategory === 'done';
  const waitingDone = waiting.statusCategory === 'done';
  const stillBlocked = !blockerDone && isBlockedBy(waiting, blockerKey);

  if (blockerDone || waitingDone || !stillBlocked) {
    try {
      await jira.postComment(
        issueKey,
        clearedCommentAdf(record, { blockerDone, waitingDone, blockerGone }),
      );
    } catch {
      // Comment failed: still clear — the block is gone either way.
    }
    await clearTracked(kvs, issueKey);
    return 'cleared';
  }

  const slaHours = record.slaHours ?? SLA_HOURS;
  const requestedAtMs = Date.parse(record.requestedAt);
  const deadlineMs = requestedAtMs + slaHours * MS_PER_HOUR;
  const pastSla = Number.isFinite(deadlineMs) && now.getTime() > deadlineMs;
  if (pastSla && !record.escalatedAt) {
    const daysWaiting = Math.max(
      1,
      Math.floor((now.getTime() - requestedAtMs) / MS_PER_DAY),
    );
    const draft = buildEscalationDraft({
      waitingIssue: waiting,
      blocker,
      unblocker: { accountId: record.unblockerAccountId, displayName: record.unblockerName },
      daysWaiting,
    });
    await jira.postComment(blockerKey, draft.adf);
    await markEscalated(kvs, issueKey, now.toISOString());
    return 'escalated';
  }

  return 'skipped';
}

export async function run(event) {
  const summary = { checked: 0, cleared: 0, escalated: 0, errors: 0 };
  const logSummary = () => {
    console.log(
      JSON.stringify({
        event: 'unjam-daily-watch',
        ...summary,
        at: new Date().toISOString(),
      }),
    );
  };

  let records;
  try {
    records = await listTracked(kvs);
  } catch {
    // Storage itself failed — nothing could be checked.
    summary.errors += 1;
    logSummary();
    return summary;
  }

  if (!records || records.length === 0) {
    logSummary();
    return { checked: 0 };
  }

  const jira = asAppJira();
  const now = new Date();
  for (const record of records) {
    summary.checked += 1;
    try {
      const outcome = await processRecord(jira, record, now);
      if (outcome === 'cleared') summary.cleared += 1;
      else if (outcome === 'escalated') summary.escalated += 1;
    } catch {
      summary.errors += 1;
    }
  }

  logSummary();
  return summary;
}
