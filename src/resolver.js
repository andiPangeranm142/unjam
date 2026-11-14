// UI Kit resolver shared by the issue panel and the project page.
//
// Every method returns an `{ error }` object on failure instead of throwing,
// so the frontend can render the failure as an error state with a retry.
// cloudId comes from req.context.cloudId when present (it may be absent,
// in which case TWG comment history is unavailable and the plan notes it).
import ResolverModule from '@forge/resolver';
import { kvs } from '@forge/kvs';
import { buildDraft } from './lib/draft.js';
import { asUserJira, asUserTwg } from './lib/forge-clients.js';
import { buildProjectBlocks, buildUnblockPlan } from './lib/plan.js';
import { daysBetween } from './lib/scoring.js';
import { getTracked, trackRequest } from './lib/tracking.js';

// @forge/resolver is a CommonJS module whose class is its `default` export.
// How a default import resolves depends on the toolchain: Forge's webpack
// bundler unwraps `exports.default` for `__esModule` modules, but raw Node
// ESM and esbuild resolve it to the whole `module.exports` object instead
// ("Resolver is not a constructor" — reproduced locally, and reported by
// developers running code outside the Forge bundler). Unwrap defensively so
// this file works under every interop.
const Resolver = ResolverModule?.default ?? ResolverModule;

const resolver = new Resolver();

function clients() {
  return { jira: asUserJira(), twg: asUserTwg() };
}

function cloudIdOf(req) {
  return req?.context?.cloudId ?? null;
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

// Summarized project block for the table: only what the page renders, so a
// project with many blocked issues still returns a small response.
function summarizeProjectBlock(block) {
  return {
    issue: {
      key: block.issue.key,
      summary: block.issue.summary,
      status: block.issue.status,
      assignee: personSummary(block.issue.assignee),
    },
    blocker: {
      key: block.blocker.key,
      summary: block.blocker.summary,
      status: block.blocker.status,
      assignee: personSummary(block.blocker.assignee),
    },
    cost: block.cost
      ? { total: block.cost.total, label: block.cost.label, reasons: block.cost.reasons }
      : null,
    topUnblocker: personSummary(block.topUnblocker),
    ageDays: block.ageDays,
    waitingCount: block.waitingCount,
  };
}

// Context for a rebuilt draft: the blocker's age and how many issues wait on
// it. plan.draft already carries these; the draft rebuilt here (send path)
// needs them computed so the posted message is just as informative.
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
// getUnblockPlan — full plan for one issue, plus its tracking record.
// The draft ADF is stripped before returning: the panel only displays the
// draft text, and the ADF is rebuilt server-side when a request is posted.
// ---------------------------------------------------------------------------

resolver.define('getUnblockPlan', async (req) => {
  try {
    const issueKey = req?.payload?.issueKey;
    if (!issueKey || typeof issueKey !== 'string') {
      return { error: 'No issue key was provided.' };
    }
    const { jira, twg } = clients();
    const plan = await buildUnblockPlan({ jira, twg }, issueKey, {
      cloudId: cloudIdOf(req),
    });
    let tracking = null;
    try {
      tracking = await getTracked(kvs, plan.issue.key);
    } catch {
      // Tracking is secondary — a failed read must not fail the whole plan.
      plan.notes.push('Tracking status could not be read.');
    }
    return {
      ...plan,
      tracking,
      draft: plan.draft ? { text: plan.draft.text } : null,
    };
  } catch (err) {
    return { error: `Could not load the unblock plan: ${errorText(err)}` };
  }
});

// ---------------------------------------------------------------------------
// sendRequest — post the unblock request comment to the blocker issue (as the
// user) and start SLA tracking. The blocker must be a real open blocker of
// the waiting issue, and the unblocker is resolved from the plan (or by
// accountId via personName when it is not a ranked candidate).
// ---------------------------------------------------------------------------

resolver.define('sendRequest', async (req) => {
  try {
    const { issueKey, blockerKey, unblockerAccountId, message } = req?.payload ?? {};
    if (!issueKey || !blockerKey || !unblockerAccountId) {
      return {
        error: 'Missing issue, blocker, or unblocker. Reload the panel and try again.',
      };
    }
    const { jira, twg } = clients();
    const plan = await buildUnblockPlan({ jira, twg }, issueKey, {
      cloudId: cloudIdOf(req),
    });
    if (!plan.isBlocked) {
      return { error: `${plan.issue.key} is no longer blocked, so there is no request to send.` };
    }
    const blocker =
      plan.openBlockers.find((node) => node.key === blockerKey) ??
      plan.chain.find((node) => node.key === blockerKey && node.statusCategory !== 'done');
    if (!blocker) {
      return { error: `${blockerKey} is not an open blocker of ${plan.issue.key}.` };
    }
    let unblocker = plan.unblockers.find((c) => c.accountId === unblockerAccountId) ?? null;
    let unblockerName = unblocker?.displayName;
    if (!unblocker) {
      unblockerName = await jira.personName(unblockerAccountId);
      unblocker = { accountId: unblockerAccountId, displayName: unblockerName };
    }

    let draft = buildDraft({
      waitingIssue: plan.issue,
      blocker,
      unblocker,
      cost: plan.cost,
      ...draftContextFor(blocker),
    });
    const customMessage = typeof message === 'string' ? message.trim() : '';
    if (customMessage) {
      draft = { ...draft, adf: appendParagraph(draft.adf, customMessage) };
    }

    const { id: commentId } = await jira.postComment(blocker.key, draft.adf);

    // Tracking failure must not fail the call — the comment is already live.
    let tracking = null;
    const notes = [];
    try {
      tracking = await trackRequest(kvs, {
        issueKey: plan.issue.key,
        blockerKey: blocker.key,
        unblockerAccountId,
        unblockerName,
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
      notes,
    };
  } catch (err) {
    return { error: `Could not send the request: ${errorText(err)}` };
  }
});

// ---------------------------------------------------------------------------
// getProjectBlocks — blocked work in a project, costliest first.
// ---------------------------------------------------------------------------

resolver.define('getProjectBlocks', async (req) => {
  try {
    const projectKey = req?.payload?.projectKey;
    if (!projectKey || typeof projectKey !== 'string') {
      return { error: 'No project key was provided.' };
    }
    const result = await buildProjectBlocks(clients(), projectKey);
    return {
      projectKey: result.projectKey,
      totalOpen: result.totalOpen,
      blockedCount: result.blockedCount,
      notes: result.notes,
      generatedAt: result.generatedAt,
      blocks: result.blocks.map(summarizeProjectBlock),
    };
  } catch (err) {
    return { error: `Could not load blocked work: ${errorText(err)}` };
  }
});

// ---------------------------------------------------------------------------
// getTracking — the active tracking record for one issue, if any.
// ---------------------------------------------------------------------------

resolver.define('getTracking', async (req) => {
  try {
    const issueKey = req?.payload?.issueKey;
    if (!issueKey || typeof issueKey !== 'string') {
      return { error: 'No issue key was provided.' };
    }
    const tracking = await getTracked(kvs, issueKey);
    return { tracking };
  } catch (err) {
    return { error: `Could not load tracking status: ${errorText(err)}` };
  }
});

export const handler = resolver.getDefinitions();
