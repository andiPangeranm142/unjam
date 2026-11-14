// Jira REST client for Unjam (CONCEPT.md sections 2.3 and 5.1).
// The HTTP fetcher is injected, so this module never imports @forge/api and
// can be tested with a fake. The fetcher contract:
//   fetcher(method, path, body|null) => { status, ok, json }
//   - method: 'GET' | 'POST'
//   - path: full path including query string
//   - body: object for POST, null otherwise
//   - the fetcher does NOT throw for HTTP error statuses; this client
//     converts them into JiraError. It MAY throw for network failures,
//     which this client also converts into JiraError.
//
// Security: every dynamic path/query part is encodeURIComponent-encoded and
// issue keys are validated against a strict regex before use, so no caller
// input can break out of its intended position in a path or JQL string.

export class JiraError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
  }
}

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/;

// Fields fetched for a fully normalized Issue (CONCEPT.md section 5.1).
const ISSUE_FIELDS = [
  'summary',
  'status',
  'assignee',
  'reporter',
  'created',
  'updated',
  'duedate',
  'priority',
  'project',
  'components',
  'labels',
  'issuelinks',
].join(',');

// getResolvedSimilar additionally needs the resolution date for recency
// weighting, so it fetches resolutiondate too.
const RESOLVED_FIELDS = `${ISSUE_FIELDS},resolutiondate`;

export function validateIssueKey(key) {
  const normalized = String(key ?? '').toUpperCase().trim();
  if (!ISSUE_KEY_RE.test(normalized)) {
    throw new JiraError(400, `Invalid issue key: ${key}`);
  }
  return normalized;
}

export function validateProjectKey(key) {
  const normalized = String(key ?? '').toUpperCase().trim();
  if (!PROJECT_KEY_RE.test(normalized)) {
    throw new JiraError(400, `Invalid project key: ${key}`);
  }
  return normalized;
}

// Escape a value for use inside a double-quoted JQL string literal.
function jqlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizePerson(person) {
  if (!person) return null;
  return {
    accountId: person.accountId ?? null,
    displayName: person.displayName ?? 'Unknown',
    ...(person.avatarUrls?.['48x48'] ? { avatarUrl: person.avatarUrls['48x48'] } : {}),
  };
}

// Normalize one raw issuelink. From this issue's point of view, a link whose
// linked issue is the inwardIssue has direction 'inward'; "is blocked by"
// therefore reads as { type: 'Blocks', direction: 'inward' }.
function normalizeIssueLink(link) {
  const type = link?.type?.name ?? 'Unknown';
  if (link?.inwardIssue?.key) {
    return { type, direction: 'inward', linkedKey: link.inwardIssue.key };
  }
  if (link?.outwardIssue?.key) {
    return { type, direction: 'outward', linkedKey: link.outwardIssue.key };
  }
  return null;
}

export function normalizeIssue(raw) {
  const fields = raw?.fields ?? {};
  return {
    key: raw.key,
    id: raw.id ?? null,
    summary: fields.summary ?? '',
    status: fields.status?.name ?? 'Unknown',
    statusCategory: fields.status?.statusCategory?.key ?? 'new',
    assignee: normalizePerson(fields.assignee),
    reporter: normalizePerson(fields.reporter),
    created: fields.created ?? null,
    updated: fields.updated ?? null,
    duedate: fields.duedate ?? null,
    resolved: fields.resolutiondate ?? null,
    priority: fields.priority?.name ?? null,
    projectKey: fields.project?.key ?? (raw.key ? raw.key.split('-')[0] : null),
    components: (fields.components ?? []).map((c) => c.name),
    labels: [...(fields.labels ?? [])],
    issueLinks: (fields.issuelinks ?? []).map(normalizeIssueLink).filter(Boolean),
  };
}

export class JiraClient {
  constructor(fetcher) {
    if (typeof fetcher !== 'function') {
      throw new TypeError('JiraClient requires a fetcher function');
    }
    this.fetcher = fetcher;
  }

  async request(method, path, body = null) {
    let res;
    try {
      res = await this.fetcher(method, path, body);
    } catch (err) {
      throw new JiraError(0, `Jira request failed: ${err?.message ?? String(err)}`);
    }
    if (!res?.ok) {
      const message =
        res?.json?.errorMessages?.join('; ') ||
        res?.json?.message ||
        `Jira request failed with status ${res?.status ?? 'unknown'}`;
      throw new JiraError(res?.status ?? 0, message);
    }
    return res.json;
  }

  async getIssue(key) {
    const validKey = validateIssueKey(key);
    const json = await this.request(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(validKey)}?fields=${encodeURIComponent(ISSUE_FIELDS)}`,
    );
    return normalizeIssue(json);
  }

  // POST /rest/api/3/search/jql (the legacy GET /search endpoint was removed
  // in September 2025). Pages via nextPageToken; truncated is true when more
  // pages exist but maxPages was reached.
  async searchJql(jql, { fields = ISSUE_FIELDS, maxResults = 50, maxPages = 2 } = {}) {
    if (!jql || !String(jql).trim()) {
      throw new JiraError(400, 'JQL must not be empty');
    }
    const fieldList = String(fields)
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    const issues = [];
    let nextPageToken = null;
    let truncated = false;
    for (let page = 0; page < maxPages; page += 1) {
      const body = { jql, fields: fieldList, maxResults };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const json = await this.request('POST', '/rest/api/3/search/jql', body);
      for (const raw of json?.issues ?? []) issues.push(normalizeIssue(raw));
      nextPageToken = json?.nextPageToken ?? null;
      if (!nextPageToken) break;
      if (page === maxPages - 1) truncated = true;
    }
    return { issues, truncated };
  }

  // How many open issues are blocked by the given blocker.
  // NOTE (CONCEPT.md section 2.3): the linkedIssues JQL reads the link type
  // from the found issue's point of view; this semantic assumption must be
  // verified on the dev site. The main chain traversal does NOT depend on
  // it (it uses issuelinks from REST instead).
  async countWaitingOn(blockerKey) {
    const validKey = validateIssueKey(blockerKey);
    const jql = `issue in linkedIssues("${validKey}", "is blocked by") AND statusCategory != Done`;
    const { issues } = await this.searchJql(jql, { fields: 'key', maxResults: 50, maxPages: 1 });
    return issues.length;
  }

  // Recently resolved issues in the same project sharing a component or
  // label with the given issue (expertise signal). Falls back to any
  // resolved issue in the project when the issue has neither.
  async getResolvedSimilar(issue, { maxResults = 25 } = {}) {
    const projectKey = validateProjectKey(issue?.projectKey);
    const clauses = [];
    if (issue?.components?.length) {
      clauses.push(`component in (${issue.components.map(jqlString).join(', ')})`);
    }
    if (issue?.labels?.length) {
      clauses.push(`labels in (${issue.labels.map(jqlString).join(', ')})`);
    }
    const similarity = clauses.length ? ` AND (${clauses.join(' OR ')})` : '';
    const jql = `project = "${projectKey}" AND statusCategory = Done${similarity} ORDER BY resolved DESC`;
    const { issues } = await this.searchJql(jql, { fields: RESOLVED_FIELDS, maxResults, maxPages: 1 });
    return issues;
  }

  async searchProjectOpenIssues(projectKey, { maxResults = 100 } = {}) {
    const validKey = validateProjectKey(projectKey);
    const jql = `project = "${validKey}" AND statusCategory != Done ORDER BY updated DESC`;
    return this.searchJql(jql, { fields: ISSUE_FIELDS, maxResults, maxPages: 2 });
  }

  async postComment(issueKey, adfBody) {
    const validKey = validateIssueKey(issueKey);
    const json = await this.request(
      'POST',
      `/rest/api/3/issue/${encodeURIComponent(validKey)}/comment`,
      { body: adfBody },
    );
    return { id: String(json.id) };
  }

  async findPerson(text) {
    const query = String(text ?? '').trim();
    if (!query) return null;
    const json = await this.request(
      'GET',
      `/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=5`,
    );
    const users = Array.isArray(json) ? json : [];
    const match = users.find((u) => u.accountType === 'atlassian' && u.active);
    if (!match) return null;
    return { accountId: match.accountId, displayName: match.displayName };
  }

  // Never throws: falls back to the raw accountId when the lookup fails.
  async personName(accountId) {
    try {
      const json = await this.request(
        'GET',
        `/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`,
      );
      return json?.displayName ?? accountId;
    } catch {
      return accountId;
    }
  }
}
