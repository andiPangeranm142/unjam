// Rovo action handlers (thin: one shared plan engine, small projections).
//
// Every handler follows the same contract (CONCEPT.md section 5.4):
//  - issueKey defaults to payload.context.jira.issueKey; cloudId comes from
//    payload.context.cloudId and may be null (TWG comment history is then
//    unavailable and the plan says so in `notes`).
//  - Total failure returns { error: '<clear message>' } — handlers never throw.
//  - Valid domain states are NOT errors: a non-blocked issue returns its
//    normal shape with empty lists / null cost plus explanatory notes. Only
//    sendUnblockRequest (a write that cannot be performed) returns { error }
//    for "not blocked" / "no unblocker", because there is nothing to send.
//  - Responses stay small (<100 KB): chain nodes and candidates are
//    summarized, unblockers are capped at 6, project blocks at 10.
import { kvs } from '@forge/kvs';
import { buildDraft } from './lib/draft.js';
import { asUserJira, asUserTwg } from './lib/forge-clients.js';
import { buildProjectBlocks, buildUnblockPlan } from './lib/plan.js';
import { daysBetween } from './lib/scoring.js';
import { trackRequest } from './lib/tracking.js';

const MAX_UNBLOCKERS = 6;
const MAX_PROJECT_BLOCKS = 10;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clients() {
  return { jira: asUserJira(), twg: asUserTwg() };
}

function inputOf(payload, name) {
  // Action inputs arrive as top-level payload keys; fall back to a nested
  // `input` object defensively in case the runtime wraps them.
  const value = payload?.[name] ?? payload?.input?.[name];
  return typeof value === 'string' ? value.trim() : value;
}

function resolveIssueKey(payload) {
  return inputOf(payload, 'issueKey') || payload?.context?.jira?.issueKey || null;
}

function cloudIdOf(payload) {
  return payload?.context?.cloudId ?? null;
}

function errorText(err) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred.';
}

function personSummary(person) {
  if (!person) return null;
  return { accountId: person.accountId, displayName: person.displayName };
}

function summarizeChainNode(node) {
  return {
    key: node.key,
    summary: node.summary,
    status: node.status,
    statusCategory: node.statusCategory,
    assignee: personSummary(node.assignee),
    depth: node.depth,
    waitingCount: node.waitingCount,
  };
}

function summarizeUnblocker(candidate) {
  return {
    name: candidate.displayName,
    accountId: candidate.accountId,
    total: candidate.total,
    breakdown: candidate.breakdown,
    reasons: candidate.reasons,
  };
}

function summarizeProjectBlock(block) {
  return {
    issueKey: block.issue.key,
    summary: block.issue.summary,
    blockerKey: block.blocker.key,
    blockerSummary: block.blocker.summary,
    ageDays: block.ageDays,
    waitingCount: block.waitingCount,
    cost: block.cost
      ? { total: block.cost.total, label: block.cost.label, reasons: block.cost.reasons }
      : null,
    topUnblocker: block.topUnblocker
      ? { name: block.topUnblocker.displayName, accountId: block.topUnblocker.accountId }
      : null,
  };
}

// Nearest open blocker (depth 1 first). buildUnblockPlan already sorts
// openBlockers by depth, so the first entry is the closest one.
function nearestOpenBlocker(plan) {
  if (plan.openBlockers && plan.openBlockers.length > 0) return plan.openBlockers[0];
  return (
    plan.chain.find((node) => node.depth === 1 && node.statusCategory !== 'done') ?? null
  );
}

// Resolve the requested unblocker: an accountId or display name that matches
// a ranked candidate wins; otherwise fall back to Jira user search.
// Returns { accountId, displayName } (a candidate or a Person) or null.
async function resolveUnblocker(jira, plan, input) {
  const needle = String(input).trim();
  if (!needle) return plan.unblockers[0] ?? null;
  const byId = plan.unblockers.find((c) => c.accountId === needle);
  if (byId) return byId;
  const byName = plan.unblockers.find(
    (c) => c.displayName && c.displayName.toLowerCase() === needle.toLowerCase(),
  );
  if (byName) return byName;
  const person = await jira.findPerson(needle);
  return person ?? null;
}

// Context for a rebuilt draft: the blocker's age and how many issues wait on
// it. plan.draft already carries these; drafts rebuilt here (named unblocker
// / send path) need them computed so the message is just as informative.
function draftContextFor(blocker) {
  return {
    ageDays: blocker?.created ? Math.max(0, daysBetween(blocker.created, new Date())) : null,
    waitingCount: blocker?.waitingCount ?? null,
  };
}

// Append a custom message as an extra paragraph to a draft's ADF body.
// Defensive: if the ADF is malformed, return it unchanged rather than failing.
function appendParagraph(adf, text) {
  if (!adf || !Array.isArray(adf.content)) return adf;
  return {
    ...adf,
    content: [
      ...adf.content,
      { type: 'paragraph', content: [{ type: 'text', text }] },
    ],
  };
}

// ---------------------------------------------------------------------------
// getBlockers — "What is blocking this issue?"
// ---------------------------------------------------------------------------

export async function getBlockers(payload) {
  try {
    const issueKey = resolveIssueKey(payload);
    if (!issueKey) {
      return { error: 'No issue specified. Open an issue in Jira or provide an issueKey.' };
    }
    const plan = await buildUnblockPlan(clients(), issueKey, { cloudId: cloudIdOf(payload) });
    return {
      issueKey: plan.issue.key,
      summary: plan.issue.summary,
      isBlocked: plan.isBlocked,
      chain: plan.chain.map(summarizeChainNode),
      notes: plan.notes,
    };
  } catch (err) {
    return { error: `Could not load blockers: ${errorText(err)}` };
  }
}

// ---------------------------------------------------------------------------
// findUnblockers — "Who can unblock this issue?"
// ---------------------------------------------------------------------------

export async function findUnblockers(payload) {
  try {
    const issueKey = resolveIssueKey(payload);
    if (!issueKey) {
      return { error: 'No issue specified. Open an issue in Jira or provide an issueKey.' };
    }
    const plan = await buildUnblockPlan(clients(), issueKey, { cloudId: cloudIdOf(payload) });
    return {
      issueKey: plan.issue.key,
      summary: plan.issue.summary,
      isBlocked: plan.isBlocked,
      unblockers: plan.unblockers.slice(0, MAX_UNBLOCKERS).map(summarizeUnblocker),
      notes: plan.notes,
    };
  } catch (err) {
    return { error: `Could not find unblockers: ${errorText(err)}` };
  }
}

// ---------------------------------------------------------------------------
// getBlockCost — "How expensive is this blocker?" (issue or project)
// ---------------------------------------------------------------------------

export async function getBlockCost(payload) {
  try {
    const projectKey = inputOf(payload, 'projectKey');
    if (projectKey) {
      const result = await buildProjectBlocks(clients(), projectKey);
      return {
        projectKey: result.projectKey,
        totalOpen: result.totalOpen,
        blockedCount: result.blockedCount,
        blocks: result.blocks.slice(0, MAX_PROJECT_BLOCKS).map(summarizeProjectBlock),
        notes: result.notes,
      };
    }
    const issueKey = resolveIssueKey(payload);
    if (!issueKey) {
      return {
        error: 'No issue or project specified. Provide an issueKey or a projectKey.',
      };
    }
    const plan = await buildUnblockPlan(clients(), issueKey, { cloudId: cloudIdOf(payload) });
    return {
      issueKey: plan.issue.key,
      summary: plan.issue.summary,
      isBlocked: plan.isBlocked,
      cost: plan.cost,
      notes: plan.notes,
    };
  } catch (err) {
    return { error: `Could not calculate block cost: ${errorText(err)}` };
  }
}

// ---------------------------------------------------------------------------
// draftUnblockRequest — "Draft an unblock request for me."
// ---------------------------------------------------------------------------

export async function draftUnblockRequest(payload) {
  try {
    const issueKey = resolveIssueKey(payload);
    if (!issueKey) {
      return { error: 'No issue specified. Open an issue in Jira or provide an issueKey.' };
    }
    const { jira, twg } = clients();
    const plan = await buildUnblockPlan({ jira, twg }, issueKey, {
      cloudId: cloudIdOf(payload),
    });
    if (!plan.isBlocked) {
      return {
        issueKey: plan.issue.key,
        blockerKey: null,
        unblocker: null,
        draftText: null,
        notes: plan.notes,
      };
    }
    const blocker = nearestOpenBlocker(plan);
    if (!blocker) {
      return {
        issueKey: plan.issue.key,
        blockerKey: null,
        unblocker: null,
        draftText: null,
        notes: [...plan.notes, 'No open blocker could be identified for this issue.'],
      };
    }
    const requested = inputOf(payload, 'unblocker');
    let unblocker;
    let draft = plan.draft;
    if (requested) {
      unblocker = await resolveUnblocker(jira, plan, requested);
      if (!unblocker) {
        return {
          error:
            `Could not find a Jira user matching "${requested}". ` +
            'Try a full name, or leave the unblocker blank to use the top-ranked candidate.',
        };
      }
      draft = buildDraft({
        waitingIssue: plan.issue,
        blocker,
        unblocker,
        cost: plan.cost,
        ...draftContextFor(blocker),
      });
    } else {
      unblocker = plan.unblockers[0] ?? null;
      if (!unblocker || !draft) {
        return {
          issueKey: plan.issue.key,
          blockerKey: blocker.key,
          unblocker: null,
          draftText: null,
          notes: [
            ...plan.notes,
            'No unblocker candidate was found for this blocker — it may be ' +
              'unassigned with no recent contributors or similar resolved work.',
          ],
        };
      }
    }
    return {
      issueKey: plan.issue.key,
      blockerKey: blocker.key,
      unblocker: personSummary(unblocker),
      draftText: draft.text,
      notes: plan.notes,
    };
  } catch (err) {
    return { error: `Could not draft the unblock request: ${errorText(err)}` };
  }
}

// ---------------------------------------------------------------------------
// sendUnblockRequest — post the request comment to the BLOCKER issue (as the
// user) and start SLA tracking. This is the only CREATE action.
// ---------------------------------------------------------------------------

export async function sendUnblockRequest(payload) {
  try {
    const issueKey = resolveIssueKey(payload);
    if (!issueKey) {
      return { error: 'No issue specified. Open an issue in Jira or provide an issueKey.' };
    }
    const { jira, twg } = clients();
    const plan = await buildUnblockPlan({ jira, twg }, issueKey, {
      cloudId: cloudIdOf(payload),
    });
    if (!plan.isBlocked) {
      return {
        error: `${plan.issue.key} is not blocked by any open issue, so there is no unblock request to send.`,
      };
    }
    const blocker = nearestOpenBlocker(plan);
    if (!blocker) {
      return {
        error: `No open blocker could be identified for ${plan.issue.key}, so there is no issue to send the request to.`,
      };
    }
    const requested = inputOf(payload, 'unblocker');
    let unblocker;
    if (requested) {
      unblocker = await resolveUnblocker(jira, plan, requested);
      if (!unblocker) {
        return {
          error:
            `Could not find a Jira user matching "${requested}". ` +
            'Try a full name, or leave the unblocker blank to use the top-ranked candidate.',
        };
      }
    } else {
      unblocker = plan.unblockers[0] ?? null;
      if (!unblocker) {
        return {
          error:
            `No one was found who can unblock ${plan.issue.key} — the blocker ` +
            `${blocker.key} may be unassigned with no recent contributors. ` +
            'Ask the blocker’s team directly, or assign the blocker first.',
        };
      }
    }

    let draft = buildDraft({
      waitingIssue: plan.issue,
      blocker,
      unblocker,
      cost: plan.cost,
      ...draftContextFor(blocker),
    });
    let draftText = draft.text;
    const message = inputOf(payload, 'message');
    if (typeof message === 'string' && message.length > 0) {
      draft = { ...draft, adf: appendParagraph(draft.adf, message) };
      draftText = `${draft.text}\n\n${message}`;
    }

    // Post to the BLOCKER issue (where the work needs to happen), as the user.
    const { id: commentId } = await jira.postComment(blocker.key, draft.adf);

    // Tracking failure must not fail the action — the comment is already live.
    const notes = [...plan.notes];
    let tracking = null;
    try {
      tracking = await trackRequest(kvs, {
        issueKey: plan.issue.key,
        blockerKey: blocker.key,
        unblockerAccountId: unblocker.accountId,
        unblockerName: unblocker.displayName,
      });
    } catch {
      notes.push(
        'The request was posted, but tracking could not be saved, so automatic ' +
          'follow-up is not active for this request.',
      );
    }

    return {
      posted: { commentId, issueKey: blocker.key, waitingIssueKey: plan.issue.key },
      tracking,
      draftText,
      notes,
    };
  } catch (err) {
    return { error: `Could not send the unblock request: ${errorText(err)}` };
  }
}
