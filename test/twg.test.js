import { OP_PREFIX, Q, TwgClient, isOpenStatus, twg, twgAll, userAri, workItemAri } from '../src/lib/twg.js';

function okResponse(data) {
  return { status: 200, ok: true, json: { data } };
}

function errorResponse(message, code) {
  return {
    status: 200,
    ok: true,
    json: { errors: [{ message, ...(code ? { extensions: { code } } : {}) }] },
  };
}

function connection(nodes, hasNextPage, endCursor = null) {
  return {
    edges: nodes.map((node) => ({ node })),
    pageInfo: { hasNextPage, endCursor },
  };
}

describe('ARI helpers and open-status check', () => {
  test('userAri and workItemAri build the documented ARI shapes', () => {
    expect(userAri('abc123')).toBe('ari:cloud:identity::user/abc123');
    expect(workItemAri('cloud-1', '10042')).toBe('ari:cloud:jira/cloud-1:issue/10042');
  });

  test('isOpenStatus treats done/closed/resolved as closed, case-insensitively', () => {
    expect(isOpenStatus('In Progress')).toBe(true);
    expect(isOpenStatus('To Do')).toBe(true);
    expect(isOpenStatus(null)).toBe(true);
    expect(isOpenStatus('Done')).toBe(false);
    expect(isOpenStatus('DONE')).toBe(false);
    expect(isOpenStatus('Closed')).toBe(false);
    expect(isOpenStatus('Resolved')).toBe(false);
    expect(isOpenStatus('Almost Done')).toBe(true);
  });
});

describe('twg()', () => {
  test('returns data on success and substitutes the operation name', async () => {
    const seen = [];
    const queryFn = async (queryText, variables, operationName) => {
      seen.push({ queryText, variables, operationName });
      return okResponse({ atlassianUserInTeams: connection([], false) });
    };
    const result = await twg(queryFn, 'unjam_userTeams', Q.userTeams, { userId: 'u1' });
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0].operationName).toBe('unjam_userTeams');
    expect(seen[0].queryText).toContain('query unjam_userTeams(');
    expect(seen[0].queryText).not.toContain('query OP(');
  });

  test('detects errors[] on an HTTP 200 response (DataFetchingException case)', async () => {
    const queryFn = async () => errorResponse('DataFetchingException: operation name missing');
    const result = await twg(queryFn, 'unjam_userTeams', Q.userTeams, {});
    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toContain('DataFetchingException');
  });

  test('does not retry a non-transient error', async () => {
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      return errorResponse('Field does not exist on type Query');
    };
    const result = await twg(queryFn, 'unjam_userTeams', Q.userTeams, {});
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  test('retries transient errors with backoff and succeeds', async () => {
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      if (calls < 3) return errorResponse('RATE_LIMIT: too many requests', 'RATE_LIMIT');
      return okResponse({ atlassianUserInTeams: connection([], false) });
    };
    const result = await twg(queryFn, 'unjam_userTeams', Q.userTeams, {});
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  test('retries a transient HTTP status and gives up after 3 retries', async () => {
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      return { status: 503, ok: false, json: {} };
    };
    const result = await twg(queryFn, 'unjam_userTeams', Q.userTeams, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('503');
    expect(calls).toBe(4); // initial attempt + 3 retries
  });

  test('retries a thrown network failure and then succeeds', async () => {
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket hang up');
      return okResponse({ atlassianUserInTeams: connection([], false) });
    };
    const result = await twg(queryFn, 'unjam_userTeams', Q.userTeams, {});
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('twgAll()', () => {
  test('pages through a short first page while hasNextPage is true', async () => {
    const pages = [
      okResponse({ atlassianUserAssignedJiraWorkItems: connection([{ key: 'A-1' }, { key: 'A-2' }], true, 'c1') }),
      okResponse({ atlassianUserAssignedJiraWorkItems: connection([{ key: 'A-3' }], false) }),
    ];
    let calls = 0;
    const queryFn = async (queryText, variables) => {
      const page = pages[calls];
      calls += 1;
      if (calls === 1) expect(variables.first).toBe(25);
      if (calls === 2) expect(variables.after).toBe('c1');
      return page;
    };
    const result = await twgAll(queryFn, 'unjam_assignedWork', Q.assignedWork, { userId: 'u1' }, 'atlassianUserAssignedJiraWorkItems', 4);
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.nodes.map((n) => n.key)).toEqual(['A-1', 'A-2', 'A-3']);
  });

  test('an empty page with hasNextPage true is treated as unreadable, not empty', async () => {
    const queryFn = async () => okResponse({
      atlassianUserAssignedJiraWorkItems: connection([], true, 'c1'),
    });
    const result = await twgAll(queryFn, 'unjam_assignedWork', Q.assignedWork, { userId: 'u1' }, 'atlassianUserAssignedJiraWorkItems', 4);
    expect(result.ok).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.error).toMatch(/empty page|rate limit/i);
  });

  test('an empty page with hasNextPage false is a genuine empty result', async () => {
    const queryFn = async () => okResponse({
      atlassianUserAssignedJiraWorkItems: connection([], false),
    });
    const result = await twgAll(queryFn, 'unjam_assignedWork', Q.assignedWork, { userId: 'u1' }, 'atlassianUserAssignedJiraWorkItems', 4);
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.nodes).toEqual([]);
  });

  test('stops at maxPages with complete=false but keeps the collected nodes', async () => {
    const queryFn = async () => okResponse({
      atlassianUserAssignedJiraWorkItems: connection([{ key: 'A-1' }], true, 'c1'),
    });
    const result = await twgAll(queryFn, 'unjam_assignedWork', Q.assignedWork, { userId: 'u1' }, 'atlassianUserAssignedJiraWorkItems', 2);
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.nodes).toHaveLength(2);
  });

  test('a failed page keeps already collected nodes and reports the error', async () => {
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      if (calls === 1) {
        return okResponse({ atlassianUserAssignedJiraWorkItems: connection([{ key: 'A-1' }], true, 'c1') });
      }
      return errorResponse('Something broke');
    };
    const result = await twgAll(queryFn, 'unjam_assignedWork', Q.assignedWork, { userId: 'u1' }, 'atlassianUserAssignedJiraWorkItems', 4);
    expect(result.ok).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.nodes.map((n) => n.key)).toEqual(['A-1']);
    expect(result.error).toContain('Something broke');
  });
});

describe('TwgClient', () => {
  test('operation names use the unjam_ prefix', () => {
    expect(OP_PREFIX).toBe('unjam_');
  });

  test('getAssignedWork maps work items and never throws on failure', async () => {
    const queryFn = async () => okResponse({
      atlassianUserAssignedJiraWorkItems: connection([
        { key: 'A-1', summary: 'First', webUrl: 'https://x/browse/A-1', status: { name: 'In Progress' } },
        { key: 'A-2', summary: 'Second', webUrl: 'https://x/browse/A-2', status: { name: 'Done' } },
      ], false),
    });
    const client = new TwgClient(queryFn);
    const { items, notes } = await client.getAssignedWork('u1');
    expect(notes).toEqual([]);
    expect(items).toEqual([
      { key: 'A-1', summary: 'First', status: 'In Progress', webUrl: 'https://x/browse/A-1' },
      { key: 'A-2', summary: 'Second', status: 'Done', webUrl: 'https://x/browse/A-2' },
    ]);

    const failing = new TwgClient(async () => errorResponse('boom'));
    const failed = await failing.getAssignedWork('u1');
    expect(failed.items).toEqual([]);
    expect(failed.notes).toHaveLength(1);
    expect(failed.notes[0]).toMatch(/could not be read/);
  });

  test('getCommenters groups by author with counts and latest timestamps', async () => {
    const queryFn = async () => okResponse({
      jiraWorkItemComments: connection([
        { createdAt: '2026-11-10T10:00:00.000Z', author: { name: 'Maya', accountId: 'u-maya' } },
        { createdAt: '2026-11-12T10:00:00.000Z', author: { name: 'Maya', accountId: 'u-maya' } },
        { createdAt: '2026-11-11T10:00:00.000Z', author: { name: 'Priya', accountId: 'u-priya' } },
        { createdAt: '2026-11-11T10:00:00.000Z', author: { name: 'Bot' } }, // no accountId: skipped
      ], false),
    });
    const client = new TwgClient(queryFn);
    const { items, notes } = await client.getCommenters('ari:cloud:jira/c1:issue/1001');
    expect(notes).toEqual([]);
    expect(items).toEqual([
      { accountId: 'u-maya', displayName: 'Maya', count: 2, lastAt: '2026-11-12T10:00:00.000Z' },
      { accountId: 'u-priya', displayName: 'Priya', count: 1, lastAt: '2026-11-11T10:00:00.000Z' },
    ]);
  });

  test('getCommenters without an issue ARI explains the missing site id', async () => {
    const client = new TwgClient(async () => okResponse({}));
    const { items, notes } = await client.getCommenters(null);
    expect(items).toEqual([]);
    expect(notes).toEqual(['comment history could not be read: site id unavailable']);
  });

  test('getUserTeams and getTeamMembers map their nodes', async () => {
    const teamsFn = async () => okResponse({
      atlassianUserInTeams: connection([{ id: 'team-1', displayName: 'Platform' }], false),
    });
    const client = new TwgClient(teamsFn);
    const teams = await client.getUserTeams('u1');
    expect(teams.items).toEqual([{ id: 'team-1', displayName: 'Platform' }]);
    expect(teams.notes).toEqual([]);

    const membersFn = async () => okResponse({
      atlassianTeamMembers: connection([{ accountId: 'u1', name: 'Maya' }], false),
    });
    const members = await new TwgClient(membersFn).getTeamMembers('team-1');
    expect(members.items).toEqual([{ accountId: 'u1', displayName: 'Maya' }]);
  });

  test('a rate-limit empty page surfaces as a note, not an empty success', async () => {
    const queryFn = async () => okResponse({
      atlassianUserAssignedJiraWorkItems: connection([], true, 'c1'),
    });
    const { items, notes } = await new TwgClient(queryFn).getAssignedWork('u1');
    expect(items).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/could not be read/);
  });
});
