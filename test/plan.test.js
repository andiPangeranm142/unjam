import { buildProjectBlocks, buildUnblockPlan } from '../src/lib/plan.js';
import { workItemAri } from '../src/lib/twg.js';
import { FakeJira, FakeTwg, blocksLink, makeIssue, makePerson } from './helpers.js';

const NOW = new Date('2026-11-14T00:00:00.000Z');
const CLOUD_ID = 'cloud-1';

const maya = makePerson('u-maya', 'Maya Chen');
const jonas = makePerson('u-jonas', 'Jonas Weber');
const priya = makePerson('u-priya', 'Priya Nair');
const sofia = makePerson('u-sofia', 'Sofia Marino');
const daniel = makePerson('u-daniel', 'Daniel Okafor');

function blockedSetup() {
  const waiting = makeIssue({
    key: 'ORB-45',
    summary: 'Release 4.2 to the App Store',
    created: '2026-11-08T00:00:00.000Z',
    duedate: '2026-11-20',
    priority: 'High',
    reporter: maya,
    assignee: jonas,
    issueLinks: [blocksLink('ORB-31')],
  });
  const blocker31 = makeIssue({
    key: 'ORB-31',
    summary: 'Payments API returns rate-limit errors under load',
    created: '2026-11-01T00:00:00.000Z',
    assignee: priya,
    reporter: sofia,
    issueLinks: [blocksLink('ORB-27')],
  });
  const blocker27 = makeIssue({
    key: 'ORB-27',
    summary: 'Legal approval for new payment terms',
    created: '2026-10-25T00:00:00.000Z',
    assignee: daniel,
    reporter: maya,
    issueLinks: [],
  });
  const jira = new FakeJira([waiting, blocker31, blocker27]);
  jira.waitingCounts.set('ORB-31', 3);
  jira.waitingCounts.set('ORB-27', 1);

  const ari45 = workItemAri(CLOUD_ID, waiting.id);
  const ari31 = workItemAri(CLOUD_ID, blocker31.id);
  const twg = new FakeTwg({
    commenters: {
      [ari31]: [{ accountId: 'u-priya', displayName: 'Priya Nair', count: 3, lastAt: '2026-11-13T10:00:00.000Z' }],
      [ari45]: [],
    },
    assignedWork: {
      'u-priya': [{ key: 'ORB-99', summary: 'One thing', status: 'In Progress', webUrl: null }],
      'u-daniel': Array.from({ length: 7 }, (_, i) => ({
        key: `ORB-9${i}`, summary: `Busy ${i}`, status: 'In Progress', webUrl: null,
      })),
    },
    teams: {
      'u-maya': [{ id: 'team-mobile', displayName: 'Mobile' }],
      'u-jonas': [{ id: 'team-mobile', displayName: 'Mobile' }],
      'u-priya': [{ id: 'team-mobile', displayName: 'Mobile' }],
    },
  });
  return { jira, twg, waiting, blocker31, blocker27 };
}

describe('buildUnblockPlan — blocked issue', () => {
  test('returns the full plan: chain, ranked unblockers, cost, draft', async () => {
    const { jira, twg } = blockedSetup();
    const plan = await buildUnblockPlan({ jira, twg }, 'ORB-45', { cloudId: CLOUD_ID, now: NOW });

    expect(plan.issue.key).toBe('ORB-45');
    expect(plan.isBlocked).toBe(true);
    expect(plan.generatedAt).toBe('2026-11-14T00:00:00.000Z');
    expect(plan.tracking).toBeNull();
    expect(plan.chain.map((n) => [n.key, n.depth])).toEqual([['ORB-31', 1], ['ORB-27', 2]]);
    expect(plan.openBlockers.map((n) => n.key)).toEqual(['ORB-31', 'ORB-27']);

    // Priya: ownership 35 + expertise 0 + availability 20 + familiarity 10 + team 10 = 75.
    expect(plan.unblockers[0].accountId).toBe('u-priya');
    expect(plan.unblockers[0].total).toBe(75);
    expect(plan.unblockers[0].breakdown).toEqual({
      ownership: 35, expertise: 0, availability: 20, familiarity: 10, team: 10,
    });
    // Sorted by total descending.
    const totals = plan.unblockers.map((u) => u.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);

    // Cost from the most expensive (oldest) blocker ORB-27: age 20d = 33,
    // waiting 1 = 8, due in 6 days = 14, priority High = 7 -> 62, High.
    expect(plan.cost.total).toBe(62);
    expect(plan.cost.label).toBe('High');
    expect(plan.cost.breakdown).toEqual({ age: 33, waiting: 8, deadline: 14, priority: 7 });

    // Draft for the top unblocker + the nearest open blocker (ORB-31).
    expect(plan.draft.text).toContain('@Priya Nair');
    expect(plan.draft.text).toContain('ORB-45');
    expect(plan.draft.text).toContain('ORB-31');
    expect(plan.draft.text).toContain('Blocked for 13 days');
    expect(plan.draft.text).toContain('3 issues waiting');
    const mention = plan.draft.adf.content[0].content.find((n) => n.type === 'mention');
    expect(mention.attrs).toEqual({ id: 'u-priya', text: '@Priya Nair' });

    expect(plan.notes).toEqual([]);
  });

  test('a missing waiting count is assumed to be 1 and noted', async () => {
    const { jira, twg } = blockedSetup();
    jira.failCount.add('ORB-27'); // the oldest blocker: waitingCount becomes null
    const plan = await buildUnblockPlan({ jira, twg }, 'ORB-45', { cloudId: CLOUD_ID, now: NOW });
    expect(plan.cost.breakdown.waiting).toBe(8);
    expect(plan.notes.some((n) => n.includes('ORB-27') && n.includes('could not be read'))).toBe(true);
  });

  test('partial TWG failure still yields a plan with honest notes', async () => {
    const { jira } = blockedSetup();
    const failingTwg = new FakeTwg({
      fail: {
        assignedWork: new Set(['u-priya', 'u-sofia', 'u-daniel', 'u-maya', 'u-jonas']),
        commenters: new Set([
          workItemAri(CLOUD_ID, '10045'),
          workItemAri(CLOUD_ID, '10031'),
          workItemAri(CLOUD_ID, '10027'),
        ]),
        teams: new Set(['u-priya', 'u-sofia', 'u-daniel', 'u-maya', 'u-jonas']),
      },
    });
    const plan = await buildUnblockPlan({ jira, twg: failingTwg }, 'ORB-45', { cloudId: CLOUD_ID, now: NOW });

    expect(plan.isBlocked).toBe(true);
    expect(plan.cost).not.toBeNull();
    expect(plan.draft).not.toBeNull();
    // Ownership signals come from Jira alone, so Priya still ranks first —
    // with neutral availability (50 -> 10 points) and no familiarity/team.
    expect(plan.unblockers[0].accountId).toBe('u-priya');
    expect(plan.unblockers[0].total).toBe(35 + 0 + 10 + 0 + 0);
    expect(plan.notes.some((n) => n.includes('could not be read'))).toBe(true);
  });

  test('no candidates at all means no draft, with an explanatory note', async () => {
    const waiting = makeIssue({
      key: 'ORB-45', reporter: maya, assignee: jonas, issueLinks: [blocksLink('ORB-31')],
    });
    const blocker = makeIssue({
      key: 'ORB-31', assignee: null, reporter: null, issueLinks: [],
    });
    const jira = new FakeJira([waiting, blocker]);
    const plan = await buildUnblockPlan({ jira, twg: new FakeTwg() }, 'ORB-45', { cloudId: null, now: NOW });
    expect(plan.isBlocked).toBe(true);
    expect(plan.unblockers).toEqual([]);
    expect(plan.draft).toBeNull();
    expect(plan.notes).toContain('No unblocker candidates could be found, so no draft was created.');
  });
});

describe('buildUnblockPlan — not blocked', () => {
  test('an issue with no blockers is reported clearly with null cost/draft', async () => {
    const jira = new FakeJira([makeIssue({ key: 'ORB-45', issueLinks: [] })]);
    const plan = await buildUnblockPlan({ jira, twg: new FakeTwg() }, 'ORB-45', { cloudId: CLOUD_ID, now: NOW });
    expect(plan.isBlocked).toBe(false);
    expect(plan.chain).toEqual([]);
    expect(plan.openBlockers).toEqual([]);
    expect(plan.unblockers).toEqual([]);
    expect(plan.cost).toBeNull();
    expect(plan.draft).toBeNull();
    expect(plan.notes).toContain('This issue is not blocked by any open issue.');
  });

  test('an issue blocked only by a Done issue is not blocked', async () => {
    const jira = new FakeJira([
      makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-31')] }),
      makeIssue({ key: 'ORB-31', status: 'Done', statusCategory: 'done', issueLinks: [] }),
    ]);
    const plan = await buildUnblockPlan({ jira, twg: new FakeTwg() }, 'ORB-45', { cloudId: CLOUD_ID, now: NOW });
    expect(plan.isBlocked).toBe(false);
    expect(plan.chain).toHaveLength(1); // the done blocker is still traced
    expect(plan.cost).toBeNull();
    expect(plan.notes).toContain('This issue is not blocked by any open issue.');
  });
});

describe('buildProjectBlocks', () => {
  test('lists blocked work sorted by cost, with waiting counts from fetched issues', async () => {
    const blocker31 = makeIssue({
      key: 'ORB-31', created: '2026-11-01T00:00:00.000Z', assignee: priya, issueLinks: [],
    });
    const blocker27 = makeIssue({
      key: 'ORB-27', status: 'Done', statusCategory: 'done', issueLinks: [],
    });
    const jira = new FakeJira([
      makeIssue({
        key: 'ORB-45', created: '2026-11-08T00:00:00.000Z', duedate: '2026-11-20',
        priority: 'High', issueLinks: [blocksLink('ORB-31')],
      }),
      makeIssue({
        key: 'ORB-38', created: '2026-11-05T00:00:00.000Z', priority: 'Low',
        issueLinks: [blocksLink('ORB-31'), blocksLink('ORB-27')],
      }),
      makeIssue({ key: 'ORB-51', issueLinks: [] }),
      blocker31,
      blocker27,
    ]);

    const result = await buildProjectBlocks({ jira, twg: new FakeTwg() }, 'ORB', { now: NOW });
    expect(result.projectKey).toBe('ORB');
    expect(result.totalOpen).toBe(4);
    expect(result.blockedCount).toBe(2);
    expect(result.blocks.map((b) => b.issue.key)).toEqual(['ORB-45', 'ORB-38']);

    // ORB-45: blocker age 13d = 25, waiting 2 = 16, due in 6d = 14, High = 7 -> 62.
    expect(result.blocks[0].cost.total).toBe(62);
    expect(result.blocks[0].cost.label).toBe('High');
    expect(result.blocks[0].blocker.key).toBe('ORB-31');
    expect(result.blocks[0].waitingCount).toBe(2);
    expect(result.blocks[0].ageDays).toBe(13);
    expect(result.blocks[0].topUnblocker).toEqual(priya);
    // ORB-38: 25 + 16 + 0 + 1 = 42. The done blocker ORB-27 produced no row.
    expect(result.blocks[1].cost.total).toBe(42);
    expect(result.blocks[1].waitingCount).toBe(2);
    expect(result.notes).toEqual([]);
  });

  test('an unassigned blocker yields a null top unblocker', async () => {
    const jira = new FakeJira([
      makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-31')] }),
      makeIssue({ key: 'ORB-31', assignee: null, issueLinks: [] }),
    ]);
    const result = await buildProjectBlocks({ jira, twg: new FakeTwg() }, 'ORB', { now: NOW });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].topUnblocker).toBeNull();
  });

  test('a truncated project scan is noted', async () => {
    const jira = new FakeJira([
      makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-31')] }),
      makeIssue({ key: 'ORB-31', issueLinks: [] }),
    ]);
    jira.truncated = true;
    const result = await buildProjectBlocks({ jira, twg: new FakeTwg() }, 'ORB', { now: NOW, maxIssues: 100 });
    expect(result.notes.some((n) => n.includes('truncated at 100'))).toBe(true);
  });

  test('an empty project reports no blocked work', async () => {
    const jira = new FakeJira([makeIssue({ key: 'ORB-51', issueLinks: [] })]);
    const result = await buildProjectBlocks({ jira, twg: new FakeTwg() }, 'ORB', { now: NOW });
    expect(result.blocks).toEqual([]);
    expect(result.blockedCount).toBe(0);
    expect(result.totalOpen).toBe(1);
  });
});
