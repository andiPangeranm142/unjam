// Teamwork Graph client for Unjam (CONCEPT.md sections 2.1 and 5.2).
// The GraphQL query function is injected, so this module never imports
// @forge/api and can be tested with a fake. The queryFn contract:
//   queryFn(queryText, variables, operationName) => { status, ok, json }
//   - json is the raw GraphQL body: { data?, errors? }
//
// Hard-won API facts encoded here:
//   - Every query needs an operation name of the form [company]_[operation];
//     without one the API answers HTTP 200 carrying a DataFetchingException,
//     so errors[] must always be checked, never just res.ok.
//   - Pages hold at most 25 rows; a page may be short while hasNextPage is
//     still true, so loop until hasNextPage is false.
//   - A rate-limited call can answer with 0 rows; that means "unreadable",
//     not "empty".
//   - Missing scopes silently drop rows, so callers must treat partial
//     results as possibly incomplete (see notes).
//
// TwgClient methods NEVER throw for partial failure: they return
// { items, notes }, with notes explaining every unreadable source.

export const OP_PREFIX = 'unjam_';

// Curated GraphQL queries (CONCEPT.md section 2.1). `OP` is a placeholder
// replaced with the real operation name at call time, because the operation
// name must appear both in the document and as the operationName argument.
export const Q = {
  userTeams: `query OP($userId: ID!, $first: Int, $after: String) {
  atlassianUserInTeams(userId: $userId, first: $first, after: $after) {
    edges { node { ... on AtlassianTeam { id displayName } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
  teamMembers: `query OP($teamAri: ID!, $first: Int, $after: String) {
  atlassianTeamMembers(teamAri: $teamAri, first: $first, after: $after) {
    edges { node { ... on AtlassianUser { accountId name } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
  assignedWork: `query OP($userId: ID!, $first: Int, $after: String) {
  atlassianUserAssignedJiraWorkItems(userId: $userId, first: $first, after: $after) {
    edges { node { ... on JiraWorkItem { key summary webUrl status { name } } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
  workItemComments: `query OP($id: ID!, $since: String!, $first: Int, $after: String) {
  jiraWorkItemComments(id: $id, since: $since, first: $first, after: $after) {
    edges { node { ... on JiraWorkItemComment { createdAt author { name ... on AtlassianUser { accountId } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
};

export function userAri(accountId) {
  return `ari:cloud:identity::user/${accountId}`;
}

export function workItemAri(cloudId, numericIssueId) {
  return `ari:cloud:jira/${cloudId}:issue/${numericIssueId}`;
}

// Open-status check for Teamwork Graph status names (CONCEPT.md section 2.1).
export function isOpenStatus(statusName) {
  return !/^(done|closed|resolved)$/i.test(String(statusName ?? ''));
}

const TRANSIENT_RE = /RATE_LIMIT|THROTTL|429|502|503|504/i;
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const PAGE_SIZE = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt) {
  return Math.min(1200, 200 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function withOperationName(query, opName) {
  return query.replace('query OP(', `query ${opName}(`);
}

// One GraphQL call with retries for transient errors.
// Returns { ok, data, error, ms }. Never throws.
export async function twg(queryFn, opName, query, variables) {
  const started = Date.now();
  const queryText = withOperationName(query, opName);
  let lastError = 'Unknown Teamwork Graph error';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let res;
    try {
      res = await queryFn(queryText, variables, opName);
    } catch (err) {
      lastError = err?.message ?? String(err);
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: false, data: null, error: lastError, ms: Date.now() - started };
    }

    const json = res?.json ?? {};
    const errors = Array.isArray(json.errors) ? json.errors : [];
    const transientStatus = TRANSIENT_STATUSES.has(res?.status);

    // HTTP 200 can still carry errors (e.g. DataFetchingException) — the
    // errors array is the authority, not the status code.
    if (errors.length > 0) {
      const message = errors.map((e) => e?.message ?? 'GraphQL error').join('; ');
      const transient =
        TRANSIENT_RE.test(message) || errors.some((e) => TRANSIENT_RE.test(e?.extensions?.code ?? ''));
      lastError = message;
      if ((transient || transientStatus) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: false, data: null, error: message, ms: Date.now() - started };
    }

    if (!res?.ok || transientStatus) {
      lastError = `Teamwork Graph request failed with status ${res?.status ?? 'unknown'}`;
      if (transientStatus && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { ok: false, data: null, error: lastError, ms: Date.now() - started };
    }

    return { ok: true, data: json.data ?? null, error: null, ms: Date.now() - started };
  }
  return { ok: false, data: null, error: lastError, ms: Date.now() - started };
}

// Page through a connection field (25 rows/page) until hasNextPage is false
// or maxPages is reached. Returns { ok, nodes, complete, error }.
// `complete` is false when the page limit stopped the walk, or when a page
// failed. A page that returns 0 rows while claiming more pages exist is
// treated as unreadable (a rate-limited call can answer with 0 rows),
// not as an empty result.
export async function twgAll(queryFn, opName, query, variables, field, maxPages = 4) {
  const nodes = [];
  let after;
  for (let page = 0; page < maxPages; page += 1) {
    const pageVariables = { ...variables, first: PAGE_SIZE };
    if (after) pageVariables.after = after;
    const result = await twg(queryFn, opName, query, pageVariables);
    if (!result.ok) {
      return { ok: false, nodes, complete: false, error: result.error };
    }
    const connection = result.data?.[field];
    const edges = connection?.edges ?? [];
    const pageInfo = connection?.pageInfo ?? {};
    if (edges.length === 0 && pageInfo.hasNextPage) {
      return {
        ok: false,
        nodes,
        complete: false,
        error:
          'Teamwork Graph returned an empty page while more results were expected (possible rate limit)',
      };
    }
    for (const edge of edges) {
      if (edge?.node) nodes.push(edge.node);
    }
    if (!pageInfo.hasNextPage) {
      return { ok: true, nodes, complete: true, error: null };
    }
    if (!pageInfo.endCursor) {
      return { ok: true, nodes, complete: true, error: null };
    }
    after = pageInfo.endCursor;
  }
  return { ok: true, nodes, complete: false, error: null };
}

export class TwgClient {
  constructor(queryFn) {
    if (typeof queryFn !== 'function') {
      throw new TypeError('TwgClient requires a query function');
    }
    this.queryFn = queryFn;
  }

  async getAssignedWork(accountId, { maxPages = 1 } = {}) {
    const result = await twgAll(
      this.queryFn,
      `${OP_PREFIX}assignedWork`,
      Q.assignedWork,
      { userId: userAri(accountId) },
      'atlassianUserAssignedJiraWorkItems',
      maxPages,
    );
    const items = result.nodes.map((n) => ({
      key: n.key,
      summary: n.summary ?? '',
      status: n.status?.name ?? null,
      webUrl: n.webUrl ?? null,
    }));
    const notes = [];
    if (!result.ok) notes.push(`Assigned work for ${accountId} could not be read: ${result.error}`);
    else if (!result.complete) notes.push(`Assigned work for ${accountId} may be incomplete (page limit reached)`);
    return { items, notes };
  }

  async getCommenters(issueAri, { sinceDays = 90 } = {}) {
    if (!issueAri) {
      return { items: [], notes: ['comment history could not be read: site id unavailable'] };
    }
    const result = await twgAll(
      this.queryFn,
      `${OP_PREFIX}workItemComments`,
      Q.workItemComments,
      { id: issueAri, since: `P${sinceDays}D` },
      'jiraWorkItemComments',
      4,
    );
    const byAccount = new Map();
    for (const node of result.nodes) {
      const accountId = node?.author?.accountId;
      if (!accountId) continue;
      const existing = byAccount.get(accountId) ?? {
        accountId,
        displayName: node.author.name ?? 'Unknown',
        count: 0,
        lastAt: null,
      };
      existing.count += 1;
      if (node.createdAt && (!existing.lastAt || node.createdAt > existing.lastAt)) {
        existing.lastAt = node.createdAt;
      }
      byAccount.set(accountId, existing);
    }
    const items = [...byAccount.values()].sort(
      (a, b) => b.count - a.count || String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')),
    );
    const notes = [];
    if (!result.ok) notes.push(`Comment history could not be read: ${result.error}`);
    else if (!result.complete) notes.push('Comment history may be incomplete (page limit reached)');
    return { items, notes };
  }

  async getUserTeams(accountId) {
    const result = await twgAll(
      this.queryFn,
      `${OP_PREFIX}userTeams`,
      Q.userTeams,
      { userId: userAri(accountId) },
      'atlassianUserInTeams',
      4,
    );
    const items = result.nodes.map((n) => ({ id: n.id, displayName: n.displayName ?? '' }));
    const notes = [];
    if (!result.ok) notes.push(`Teams for ${accountId} could not be read: ${result.error}`);
    else if (!result.complete) notes.push(`Teams for ${accountId} may be incomplete (page limit reached)`);
    return { items, notes };
  }

  async getTeamMembers(teamAri) {
    const result = await twgAll(
      this.queryFn,
      `${OP_PREFIX}teamMembers`,
      Q.teamMembers,
      { teamAri },
      'atlassianTeamMembers',
      4,
    );
    const items = result.nodes.map((n) => ({ accountId: n.accountId, displayName: n.name ?? 'Unknown' }));
    const notes = [];
    if (!result.ok) notes.push(`Members of team ${teamAri} could not be read: ${result.error}`);
    else if (!result.complete) notes.push(`Members of team ${teamAri} may be incomplete (page limit reached)`);
    return { items, notes };
  }
}
