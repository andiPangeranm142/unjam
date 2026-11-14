// Shared fakes for Unjam unit tests. Not a test file itself
// (no .test.js suffix, so Jest does not run it).

export function makePerson(accountId, displayName) {
  return { accountId, displayName };
}

export function blocksLink(linkedKey) {
  return { type: 'Blocks', direction: 'inward', linkedKey };
}

// Normalized Issue shape (CONCEPT.md section 5.1).
export function makeIssue({
  key,
  id = `100${String(key).replace(/\D/g, '')}`,
  summary = `Summary of ${key}`,
  status = 'In Progress',
  statusCategory = 'indeterminate',
  assignee = null,
  reporter = null,
  created = '2026-11-01T00:00:00.000Z',
  updated = '2026-11-10T00:00:00.000Z',
  duedate = null,
  resolved = null,
  priority = 'Medium',
  projectKey = String(key).split('-')[0],
  components = [],
  labels = [],
  issueLinks = [],
} = {}) {
  return {
    key,
    id,
    summary,
    status,
    statusCategory,
    assignee,
    reporter,
    created,
    updated,
    duedate,
    resolved,
    priority,
    projectKey,
    components,
    labels,
    issueLinks,
  };
}

class FakeJiraError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
  }
}

// Fake JiraClient with the same method surface as the real one.
export class FakeJira {
  constructor(issues = []) {
    this.byKey = new Map(issues.map((i) => [i.key, i]));
    this.waitingCounts = new Map();
    this.resolvedSimilar = [];
    this.comments = [];
    this.failGet = new Set();
    this.failCount = new Set();
    this.failResolved = false;
    this.truncated = false;
  }

  async getIssue(key) {
    if (this.failGet.has(key)) throw new FakeJiraError(403, `Forbidden: ${key}`);
    const issue = this.byKey.get(key);
    if (!issue) throw new FakeJiraError(404, `Issue not found: ${key}`);
    return issue;
  }

  async countWaitingOn(key) {
    if (this.failCount.has(key)) throw new FakeJiraError(500, `count failed: ${key}`);
    return this.waitingCounts.get(key) ?? 0;
  }

  async getResolvedSimilar() {
    if (this.failResolved) throw new FakeJiraError(500, 'resolved search failed');
    return this.resolvedSimilar;
  }

  async searchProjectOpenIssues() {
    const issues = [...this.byKey.values()].filter((i) => i.statusCategory !== 'done');
    return { issues, truncated: this.truncated };
  }

  async postComment(issueKey, adfBody) {
    this.comments.push({ issueKey, adfBody });
    return { id: `comment-${this.comments.length}` };
  }

  async findPerson() {
    return null;
  }

  async personName(accountId) {
    return accountId;
  }
}

// Fake TwgClient with the same method surface as the real one.
// Data is keyed by accountId / issue ARI / team ARI.
export class FakeTwg {
  constructor({ assignedWork = {}, commenters = {}, teams = {}, fail = {} } = {}) {
    this.assignedWork = assignedWork;
    this.commenters = commenters;
    this.teams = teams;
    this.fail = fail; // { assignedWork: Set, commenters: Set, teams: Set }
    this.calls = { getAssignedWork: 0, getCommenters: 0, getUserTeams: 0, getTeamMembers: 0 };
  }

  async getAssignedWork(accountId) {
    this.calls.getAssignedWork += 1;
    if (this.fail.assignedWork?.has(accountId)) {
      return { items: [], notes: [`Assigned work for ${accountId} could not be read: boom`] };
    }
    return { items: this.assignedWork[accountId] ?? [], notes: [] };
  }

  async getCommenters(issueAri) {
    this.calls.getCommenters += 1;
    if (this.fail.commenters?.has(issueAri)) {
      return { items: [], notes: ['Comment history could not be read: boom'] };
    }
    return { items: this.commenters[issueAri] ?? [], notes: [] };
  }

  async getUserTeams(accountId) {
    this.calls.getUserTeams += 1;
    if (this.fail.teams?.has(accountId)) {
      return { items: [], notes: [`Teams for ${accountId} could not be read: boom`] };
    }
    return { items: this.teams[accountId] ?? [], notes: [] };
  }

  async getTeamMembers() {
    this.calls.getTeamMembers += 1;
    return { items: [], notes: [] };
  }
}

// Map-backed async storage with the injected-storage interface.
export function makeMapStorage() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? map.get(key) : undefined;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}
