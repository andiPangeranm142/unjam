import { traceBlockers } from '../src/lib/chain.js';
import { FakeJira, blocksLink, makeIssue, makePerson } from './helpers.js';

const maya = makePerson('u-maya', 'Maya Chen');
const priya = makePerson('u-priya', 'Priya Nair');

describe('traceBlockers', () => {
  test('traces a multi-hop chain in BFS order with depths', async () => {
    const jira = new FakeJira([
      makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-42')] }),
      makeIssue({ key: 'ORB-42', assignee: maya, issueLinks: [blocksLink('ORB-31')] }),
      makeIssue({ key: 'ORB-31', assignee: priya, issueLinks: [] }),
    ]);
    jira.waitingCounts.set('ORB-42', 2);
    jira.waitingCounts.set('ORB-31', 3);

    const { chain, notes } = await traceBlockers(jira, 'ORB-45');
    expect(notes).toEqual([]);
    expect(chain.map((n) => [n.key, n.depth])).toEqual([['ORB-42', 1], ['ORB-31', 2]]);
    expect(chain[0].waitingCount).toBe(2);
    expect(chain[1].waitingCount).toBe(3);
    expect(chain[0].blockedByKeys).toEqual(['ORB-31']);
    expect(chain[1].blockedByKeys).toEqual([]);
    // The starting issue is not part of its own chain.
    expect(chain.some((n) => n.key === 'ORB-45')).toBe(false);
  });

  test('is cycle-safe: a blocker pointing back to the start is visited once', async () => {
    const jira = new FakeJira([
      makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-42')] }),
      makeIssue({ key: 'ORB-42', issueLinks: [blocksLink('ORB-45'), blocksLink('ORB-31')] }),
      makeIssue({ key: 'ORB-31', issueLinks: [blocksLink('ORB-42')] }),
    ]);
    const { chain } = await traceBlockers(jira, 'ORB-45');
    expect(chain.map((n) => n.key)).toEqual(['ORB-42', 'ORB-31']);
  });

  test('respects the depth cap', async () => {
    const jira = new FakeJira([
      makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-44')] }),
      makeIssue({ key: 'ORB-44', issueLinks: [blocksLink('ORB-43')] }),
      makeIssue({ key: 'ORB-43', issueLinks: [blocksLink('ORB-42')] }),
      makeIssue({ key: 'ORB-42', issueLinks: [blocksLink('ORB-41')] }),
      makeIssue({ key: 'ORB-41', issueLinks: [] }),
    ]);
    const { chain } = await traceBlockers(jira, 'ORB-45', { maxDepth: 2 });
    expect(chain.map((n) => [n.key, n.depth])).toEqual([['ORB-44', 1], ['ORB-43', 2]]);
  });

  test('records Done blockers but does not expand past them', async () => {
    const jira = new FakeJira([
      makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-42')] }),
      makeIssue({
        key: 'ORB-42', status: 'Done', statusCategory: 'done',
        issueLinks: [blocksLink('ORB-31')],
      }),
      makeIssue({ key: 'ORB-31', issueLinks: [] }),
    ]);
    const { chain } = await traceBlockers(jira, 'ORB-45');
    expect(chain.map((n) => n.key)).toEqual(['ORB-42']);
    expect(chain[0].statusCategory).toBe('done');
    expect(chain[0].waitingCount).toBeNull(); // done blockers get no waiting lookup
  });

  test('ignores non-Blocks links and outward links', async () => {
    const jira = new FakeJira([
      makeIssue({
        key: 'ORB-45',
        issueLinks: [
          { type: 'Relates to', direction: 'inward', linkedKey: 'ORB-99' },
          { type: 'Blocks', direction: 'outward', linkedKey: 'ORB-98' },
          blocksLink('ORB-42'),
        ],
      }),
      makeIssue({ key: 'ORB-42', issueLinks: [] }),
    ]);
    const { chain } = await traceBlockers(jira, 'ORB-45');
    expect(chain.map((n) => n.key)).toEqual(['ORB-42']);
  });

  test('truncates at maxNodes with a note', async () => {
    const issues = [makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-44')] })];
    for (let i = 44; i >= 40; i -= 1) {
      issues.push(makeIssue({
        key: `ORB-${i}`,
        issueLinks: i > 40 ? [blocksLink(`ORB-${i - 1}`)] : [],
      }));
    }
    const { chain, notes } = await traceBlockers(new FakeJira(issues), 'ORB-45', { maxDepth: 10, maxNodes: 3 });
    expect(chain).toHaveLength(3);
    expect(notes).toContain('Blocker chain truncated at 3 nodes');
  });

  test('fills waitingCount for at most 10 open blockers, rest null with a note', async () => {
    const links = [];
    const issues = [];
    for (let i = 1; i <= 12; i += 1) {
      links.push(blocksLink(`ORB-${100 + i}`));
      issues.push(makeIssue({ key: `ORB-${100 + i}`, issueLinks: [] }));
    }
    const jira = new FakeJira([makeIssue({ key: 'ORB-45', issueLinks: links }), ...issues]);
    for (let i = 1; i <= 12; i += 1) jira.waitingCounts.set(`ORB-${100 + i}`, i);

    const { chain, notes } = await traceBlockers(jira, 'ORB-45');
    expect(chain).toHaveLength(12);
    expect(chain.slice(0, 10).map((n) => n.waitingCount)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(chain.slice(10).map((n) => n.waitingCount)).toEqual([null, null]);
    expect(notes).toContain('Waiting counts skipped for 2 blocker(s) (lookup limit 10)');
  });

  test('an unreadable blocker is noted and skipped, not fatal', async () => {
    const jira = new FakeJira([
      makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-42'), blocksLink('ORB-43')] }),
      makeIssue({ key: 'ORB-42', issueLinks: [] }),
      makeIssue({ key: 'ORB-43', issueLinks: [] }),
    ]);
    jira.failGet.add('ORB-43');
    const { chain, notes } = await traceBlockers(jira, 'ORB-45');
    expect(chain.map((n) => n.key)).toEqual(['ORB-42']);
    expect(notes.some((n) => n.includes('ORB-43') && n.includes('could not be read'))).toBe(true);
  });

  test('a waiting-count failure leaves null and is noted', async () => {
    const jira = new FakeJira([
      makeIssue({ key: 'ORB-45', issueLinks: [blocksLink('ORB-42')] }),
      makeIssue({ key: 'ORB-42', issueLinks: [] }),
    ]);
    jira.failCount.add('ORB-42');
    const { chain, notes } = await traceBlockers(jira, 'ORB-45');
    expect(chain[0].waitingCount).toBeNull();
    expect(notes.some((n) => n.includes('ORB-42') && n.includes('Waiting count'))).toBe(true);
  });

  test('an issue with no blockers returns an empty chain', async () => {
    const jira = new FakeJira([makeIssue({ key: 'ORB-45', issueLinks: [] })]);
    const { chain, notes } = await traceBlockers(jira, 'ORB-45');
    expect(chain).toEqual([]);
    expect(notes).toEqual([]);
  });

  test('a missing starting issue throws', async () => {
    const jira = new FakeJira([]);
    await expect(traceBlockers(jira, 'ORB-45')).rejects.toThrow('Issue not found');
  });
});
