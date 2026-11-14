// Pure draft builders for Unjam (CONCEPT.md section 5.3).
// Every draft returns both a plain-text version and an Atlassian Document
// Format (ADF) version ready to post as a Jira comment.

function mentionNode(unblocker) {
  return {
    type: 'mention',
    attrs: {
      id: unblocker.accountId,
      text: `@${unblocker.displayName ?? 'there'}`,
    },
  };
}

function textNode(text) {
  return { type: 'text', text };
}

function paragraph(content) {
  return { type: 'paragraph', content };
}

function adfDoc(content) {
  return { version: 1, type: 'doc', content };
}

// Polite @mention request to unblock a waiting issue.
// Optional extras (ageDays, waitingCount) enrich the context line when the
// caller knows them; the draft stays correct without them.
export function buildDraft({ waitingIssue, blocker, unblocker, cost, ageDays = null, waitingCount = null }) {
  const name = unblocker.displayName ?? 'there';

  const contextFragments = [];
  if (ageDays !== null && ageDays !== undefined) {
    contextFragments.push(`Blocked for ${ageDays} day${ageDays === 1 ? '' : 's'}`);
  }
  if (waitingCount !== null && waitingCount !== undefined && waitingCount > 0) {
    contextFragments.push(`${waitingCount} issue${waitingCount === 1 ? '' : 's'} waiting`);
  }
  if (waitingIssue?.duedate) {
    contextFragments.push(`Due ${waitingIssue.duedate}`);
  }
  if (cost?.label) {
    contextFragments.push(`Block cost: ${cost.label}`);
  }

  const openingText = `Hi @${name} — ${waitingIssue.key} "${waitingIssue.summary}" is blocked by ${blocker.key} "${blocker.summary}".`;
  const contextText = contextFragments.length > 0 ? contextFragments.join(' · ') : null;
  const askText = `Could you share a quick status update or unblock ${blocker.key}? Thanks!`;

  const text = [openingText, contextText, askText].filter(Boolean).join('\n\n');

  const content = [
    paragraph([
      textNode('Hi '),
      mentionNode(unblocker),
      textNode(` — ${waitingIssue.key} "${waitingIssue.summary}" is blocked by ${blocker.key} "${blocker.summary}".`),
    ]),
  ];
  if (contextText) content.push(paragraph([textNode(contextText)]));
  content.push(paragraph([textNode(askText)]));

  return { text, adf: adfDoc(content) };
}

// Polite follow-up after the 48h SLA has passed with no movement.
export function buildEscalationDraft({ waitingIssue, blocker, unblocker, daysWaiting = null }) {
  const name = unblocker.displayName ?? 'there';

  const ageClause =
    daysWaiting !== null && daysWaiting !== undefined
      ? `, which has now been blocked by ${blocker.key} for ${daysWaiting} day${daysWaiting === 1 ? '' : 's'}`
      : `, which is still blocked by ${blocker.key}`;
  const openingText = `Hi @${name} — following up on ${waitingIssue.key} "${waitingIssue.summary}"${ageClause}.`;
  const askText = `We reached out earlier and haven't heard back yet. Could you share a quick status update, or let us know who else might help unblock ${blocker.key}? Thanks!`;

  const text = `${openingText}\n\n${askText}`;

  const adf = adfDoc([
    paragraph([
      textNode('Hi '),
      mentionNode(unblocker),
      textNode(` — following up on ${waitingIssue.key} "${waitingIssue.summary}"${ageClause}.`),
    ]),
    paragraph([textNode(askText)]),
  ]);

  return { text, adf };
}
