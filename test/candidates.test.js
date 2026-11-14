import { buildCandidates } from '../src/lib/candidates.js';
import { workItemAri } from '../src/lib/twg.js';
import { FakeJira, FakeTwg, blocksLink, makeIssue, makePerson } from './helpers.js';

const NOW = new Date('2026-11-14T00:00:00.000Z');
const CLOUD_ID = 'cloud-1';

const maya = makePerson('u-maya', 'Maya Chen');
const jonas = makePerson('u-jonas', 'Jonas Weber');
const priya = makePerson('u-priya', 'Priya Nair');
const sofia = makePerson('u-sofia', 'Sofia Marino');
const daniel = makePerson('u-daniel', 'Daniel Okafor');
const expert = makePerson('u-expert', 'Elena Expert');

// Waiting issue ORB-45 <- ORB-31 (depth 1) <- ORB-27 (depth 2).
function setup({ twgOptions = {}, resolvedSimilar = [], failResolved = false } = {}) {
  const waiting = makeIssue({
    key: 'ORB-45',
    reporter: maya,
    assignee: jonas,
    issueLinks: [blocksLink('ORB-31')],
  });
  const chain = [
    {
      ...makeIssue({ key: 'ORB-31', assignee: priya, reporter: sofia, issueLinks: [blocksLink('ORB-27')] }),
      depth: 1,
      waitingCount: 3,
      blockedByKeys: ['ORB-27'],
    },
    {
      ...makeIssue({ key: 'ORB-27', assignee: daniel, reporter: maya, issueLinks: [] }),
      depth: 2,
      waitingCount: 1,
      blockedByKeys: [],
    },
  ];
  const jira = new FakeJira([waiting, chain[0], chain[1]]);
  jira.resolvedSimilar = resolvedSimilar;
  jira.failResolved = failResolved;

  const ari45 = workItemAri(CLOUD_ID, waiting.id);
  const ari31 = workItemAri(CLOUD_ID, chain[0].id);
  const twg = new FakeTwg({
    commenters: {
      [ari31]: [
        { accountId: 'u-priya', displayName: 'Priya Nair', count: 3, lastAt: '2026-11-12T10:00:00.000Z' },
      ],
      [ari45]: [
        { accountId: 'u-expert', displayName: 'Elena Expert', count: 1, lastAt: '2026-11-12T10:00:00.000Z' },
      ],
    },
    assignedWork: {
      'u-priya': [{ key: 'ORB-99', summary: 'One thing', status: 'In Progress', webUrl: null }],
      'u-daniel': Array.from({ length: 7 }, (_, i) => ({
        key: `ORB-9${i}`, summary: `Busy ${i}`, status: 'In Progress', webUrl: null,
      })),
    },
    teams: {
      'u-maya': [{ id: 'team-mobile', displayName: 'Mobile' }],
      'u-jonas': [{ id: 'team-backend', displayName: 'Backend' }],
      'u-priya': [{ id: 'team-mobile', displayName: 'Mobile' }],
      'u-sofia': [{ id: 'team-legal', displayName: 'Legal' }],
      'u-daniel': [{ id: 'team-legal', displayName: 'Legal' }],
    },
    ...twgOptions,
  });
  return { jira, twg, waiting, chain };
}

function byId(candidates, accountId) {
  return candidates.find((c) => c.accountId === accountId);
}

describe('buildCandidates', () => {
  test('merges ownership, familiarity and expertise signals for one person (dedup)', async () => {
    const { jira, twg, waiting, chain } = setup({
      resolvedSimilar: [
        // Priya resolved a similar issue 74 days ago (weight 0.6 -> value 10).
        makeIssue({ key: 'ORB-10', assignee: priya, resolved: '2026-09-01T00:00:00.000Z', statusCategory: 'done' }),
        // The expert resolved two similar issues 4 days ago (weight 1.0 each -> value 32).
        makeIssue({ key: 'ORB-11', assignee: expert, resolved: '2026-11-10T00:00:00.000Z', statusCategory: 'done' }),
        makeIssue({ key: 'ORB-12', assignee: expert, resolved: '2026-11-10T00:00:00.000Z', statusCategory: 'done' }),
      ],
    });

    const { candidates, notes } = await buildCandidates(
      { jira, twg },
      { issue: waiting, chain, cloudId: CLOUD_ID },
      { now: NOW },
    );
    expect(notes).toEqual([]);

    // Priya appears once despite being blocker assignee + commenter + expert.
    const priyas = candidates.filter((c) => c.accountId === 'u-priya');
    expect(priyas).toHaveLength(1);
    const p = priyas[0];
    expect(p.signals.ownership).toEqual({ value: 100, source: 'Assignee of ORB-31 (depth 1)' });
    expect(p.signals.expertise.value).toBe(10);
    expect(p.signals.availability).toEqual({ value: 100, source: '1 open item assigned' });
    expect(p.signals.familiarity.value).toBe(100);
    expect(p.signals.team.value).toBe(100);
    expect(p.reasons).toEqual(expect.arrayContaining([
      'Owns the blocking issue ORB-31',
      'Resolved 1 similar issue',
      'Only 1 open item right now',
      'Commented on this blocker yesterday',
      'Same team as the reporter',
    ]));

    const e = byId(candidates, 'u-expert');
    expect(e.signals.ownership.value).toBe(0);
    expect(e.signals.expertise.value).toBe(32);
    expect(e.signals.familiarity.value).toBe(60); // 1 comment
    expect(e.reasons).toContain('Resolved 2 similar issues');
  });

  test('ownership values follow the role/depth scale', async () => {
    const { jira, twg, waiting, chain } = setup();
    const { candidates } = await buildCandidates(
      { jira, twg },
      { issue: waiting, chain, cloudId: CLOUD_ID },
      { now: NOW },
    );
    expect(byId(candidates, 'u-priya').signals.ownership.value).toBe(100); // assignee, depth 1
    expect(byId(candidates, 'u-sofia').signals.ownership.value).toBe(63); // reporter, depth 1
    expect(byId(candidates, 'u-daniel').signals.ownership.value).toBe(57); // assignee, depth 2
    expect(byId(candidates, 'u-maya').signals.ownership.value).toBe(34); // reporter, depth 2
  });

  test('availability follows the open-count scale', async () => {
    const { jira, twg, waiting, chain } = setup();
    const { candidates } = await buildCandidates(
      { jira, twg },
      { issue: waiting, chain, cloudId: CLOUD_ID },
      { now: NOW },
    );
    expect(byId(candidates, 'u-priya').signals.availability.value).toBe(100); // 1 open
    expect(byId(candidates, 'u-daniel').signals.availability.value).toBe(40); // 7 open
    expect(byId(candidates, 'u-sofia').signals.availability.value).toBe(100); // 0 open
  });

  test('team proximity: same team as reporter = 100, as blocker assignee = 60, self excluded', async () => {
    const { jira, twg, waiting, chain } = setup();
    const { candidates } = await buildCandidates(
      { jira, twg },
      { issue: waiting, chain, cloudId: CLOUD_ID },
      { now: NOW },
    );
    // Priya shares Mobile with the waiting reporter (Maya).
    expect(byId(candidates, 'u-priya').signals.team.value).toBe(100);
    // Sofia shares Legal with blocker assignee Daniel.
    expect(byId(candidates, 'u-sofia').signals.team.value).toBe(60);
    expect(byId(candidates, 'u-sofia').reasons).toContain('Same team as the blocker assignee');
    // Daniel must not score team points for sharing a team with himself.
    expect(byId(candidates, 'u-daniel').signals.team.value).toBe(0);
    // Maya shares Mobile with blocker assignee Priya, so she scores 60 —
    // and the fact that it is 60, not 100, proves the reporter-self match
    // did not fire (without self-exclusion she would share a team with
    // the waiting reporter: herself).
    expect(byId(candidates, 'u-maya').signals.team.value).toBe(60);
    expect(byId(candidates, 'u-maya').signals.team.source).toBe('Same team as the assignee of the blocking issue');
  });

  test('an unreadable workload falls back to the neutral value with a note', async () => {
    const { jira, twg, waiting, chain } = setup({
      twgOptions: { fail: { assignedWork: new Set(['u-priya']) } },
    });
    const { candidates, notes } = await buildCandidates(
      { jira, twg },
      { issue: waiting, chain, cloudId: CLOUD_ID },
      { now: NOW },
    );
    expect(byId(candidates, 'u-priya').signals.availability).toEqual({
      value: 50,
      source: 'Workload could not be read',
    });
    expect(notes.some((n) => n.includes('u-priya') && n.includes('could not be read'))).toBe(true);
    // Other candidates are unaffected.
    expect(byId(candidates, 'u-daniel').signals.availability.value).toBe(40);
  });

  test('without a cloudId, comment history is skipped with a note', async () => {
    const { jira, twg, waiting, chain } = setup();
    const { candidates, notes } = await buildCandidates(
      { jira, twg },
      { issue: waiting, chain, cloudId: null },
      { now: NOW },
    );
    expect(notes).toContain('comment history could not be read: site id unavailable');
    // The expert only exists via comments, so they disappear without TWG comments.
    expect(byId(candidates, 'u-expert')).toBeUndefined();
    // Blocker owners are still found from Jira alone.
    expect(byId(candidates, 'u-priya')).toBeDefined();
    expect(byId(candidates, 'u-priya').signals.familiarity.value).toBe(0);
  });

  test('a failed similar-issues lookup is noted, not fatal', async () => {
    const { jira, twg, waiting, chain } = setup({ failResolved: true });
    const { candidates, notes } = await buildCandidates(
      { jira, twg },
      { issue: waiting, chain, cloudId: CLOUD_ID },
      { now: NOW },
    );
    expect(notes.some((n) => n.includes('Similar resolved issues could not be read'))).toBe(true);
    expect(byId(candidates, 'u-priya').signals.expertise.value).toBe(0);
    expect(candidates.length).toBeGreaterThan(0);
  });

  test('candidates without an accountId are skipped', async () => {
    const { jira, twg, waiting, chain } = setup();
    chain[0].reporter = { accountId: null, displayName: 'Ghost' };
    const { candidates } = await buildCandidates(
      { jira, twg },
      { issue: waiting, chain, cloudId: CLOUD_ID },
      { now: NOW },
    );
    expect(candidates.every((c) => c.accountId)).toBe(true);
    expect(byId(candidates, 'u-sofia')).toBeUndefined();
  });

  test('caps at maxCandidates in discovery order and notes the truncation', async () => {
    const { jira, twg, waiting, chain } = setup({
      resolvedSimilar: Array.from({ length: 8 }, (_, i) => makeIssue({
        key: `ORB-2${i}`,
        assignee: makePerson(`u-extra-${i}`, `Extra ${i}`),
        resolved: '2026-11-10T00:00:00.000Z',
        statusCategory: 'done',
      })),
    });
    const { candidates, notes } = await buildCandidates(
      { jira, twg },
      { issue: waiting, chain, cloudId: CLOUD_ID },
      { now: NOW, maxCandidates: 6 },
    );
    expect(candidates).toHaveLength(6);
    // Blocker owners come first (discovery order), extras are cut.
    expect(candidates.map((c) => c.accountId)).toEqual(
      ['u-priya', 'u-sofia', 'u-daniel', 'u-maya', 'u-expert', 'u-extra-0'],
    );
    expect(notes.some((n) => n.includes('Showing 6 of 13 candidates'))).toBe(true);
  });
});
