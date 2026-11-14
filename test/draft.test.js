import { buildDraft, buildEscalationDraft } from '../src/lib/draft.js';
import { makeIssue, makePerson } from './helpers.js';

const waitingIssue = makeIssue({
  key: 'ORB-45',
  summary: 'Release 4.2 to the App Store',
  duedate: '2026-11-20',
});
const blocker = makeIssue({
  key: 'ORB-31',
  summary: 'Payments API returns rate-limit errors under load',
});
const unblocker = makePerson('u-priya', 'Priya Nair');

function findMention(adf) {
  for (const block of adf.content) {
    for (const node of block.content ?? []) {
      if (node.type === 'mention') return node;
    }
  }
  return null;
}

describe('buildDraft', () => {
  test('produces a proper ADF doc with a mention node', () => {
    const { adf } = buildDraft({
      waitingIssue,
      blocker,
      unblocker,
      cost: { total: 52, label: 'High' },
      ageDays: 6,
      waitingCount: 3,
    });
    expect(adf.version).toBe(1);
    expect(adf.type).toBe('doc');
    expect(adf.content[0].type).toBe('paragraph');
    const mention = findMention(adf);
    expect(mention).toEqual({
      type: 'mention',
      attrs: { id: 'u-priya', text: '@Priya Nair' },
    });
    // The mention is the only mention; the rest is plain text.
    const mentions = adf.content.flatMap((b) => b.content ?? []).filter((n) => n.type === 'mention');
    expect(mentions).toHaveLength(1);
  });

  test('text names both issues, the context and the specific ask', () => {
    const { text } = buildDraft({
      waitingIssue,
      blocker,
      unblocker,
      cost: { total: 52, label: 'High' },
      ageDays: 6,
      waitingCount: 3,
    });
    expect(text).toContain('@Priya Nair');
    expect(text).toContain('ORB-45 "Release 4.2 to the App Store"');
    expect(text).toContain('ORB-31 "Payments API returns rate-limit errors under load"');
    expect(text).toContain('Blocked for 6 days');
    expect(text).toContain('3 issues waiting');
    expect(text).toContain('Due 2026-11-20');
    expect(text).toContain('Block cost: High');
    expect(text).toContain('Could you share a quick status update or unblock ORB-31?');
  });

  test('omits context fragments it does not know', () => {
    const { text } = buildDraft({ waitingIssue, blocker, unblocker, cost: null });
    expect(text).toContain('ORB-45');
    expect(text).toContain('ORB-31');
    expect(text).not.toContain('Blocked for');
    expect(text).not.toContain('issues waiting');
    expect(text).not.toContain('Block cost');
    // Due date is part of the waiting issue, so it is still included.
    expect(text).toContain('Due 2026-11-20');
  });

  test('uses singular wording for one day and one waiting issue', () => {
    const { text } = buildDraft({
      waitingIssue,
      blocker,
      unblocker,
      cost: null,
      ageDays: 1,
      waitingCount: 1,
    });
    expect(text).toContain('Blocked for 1 day');
    expect(text).toContain('1 issue waiting');
    expect(text).not.toContain('1 days');
    expect(text).not.toContain('1 issues waiting');
  });

  test('ADF text matches the plain-text version', () => {
    const { text, adf } = buildDraft({
      waitingIssue,
      blocker,
      unblocker,
      cost: { total: 52, label: 'High' },
      ageDays: 6,
      waitingCount: 3,
    });
    const adfText = adf.content
      .map((block) => (block.content ?? []).map((n) => (n.type === 'mention' ? n.attrs.text : n.text)).join(''))
      .join('\n\n');
    expect(adfText).toBe(text);
  });
});

describe('buildEscalationDraft', () => {
  test('follows up politely with the days waiting and a mention', () => {
    const { text, adf } = buildEscalationDraft({
      waitingIssue,
      blocker,
      unblocker,
      daysWaiting: 4,
    });
    expect(text).toContain('@Priya Nair');
    expect(text).toContain('following up on ORB-45');
    expect(text).toContain('blocked by ORB-31 for 4 days');
    expect(text).toContain("haven't heard back yet");
    expect(text).toContain('who else might help unblock ORB-31');
    const mention = findMention(adf);
    expect(mention).toEqual({
      type: 'mention',
      attrs: { id: 'u-priya', text: '@Priya Nair' },
    });
    expect(adf.type).toBe('doc');
  });

  test('works without a days-waiting count', () => {
    const { text } = buildEscalationDraft({ waitingIssue, blocker, unblocker });
    expect(text).toContain('still blocked by ORB-31');
    expect(text).not.toContain('undefined');
  });
});
