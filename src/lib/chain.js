// Blocker-chain traversal for Unjam (CONCEPT.md section 5.3).
// Breadth-first walk over inward 'Blocks' issue links, cycle-safe, with
// depth and node caps so a tangled project cannot blow up a Rovo call.

// Keys of the issues blocking this issue ("is blocked by" from this issue's
// point of view: type 'Blocks', direction 'inward').
export function blockerKeysOf(issue) {
  return (issue?.issueLinks ?? [])
    .filter((l) => l.direction === 'inward' && String(l.type).toLowerCase() === 'blocks')
    .map((l) => l.linkedKey);
}

const MAX_WAITING_LOOKUPS = 10;

// Trace the blockers of issueKey.
// Returns { chain, notes }. chain holds ChainNodes (Issue + depth,
// waitingCount, blockedByKeys); the starting issue itself (depth 0) is NOT
// in the chain. Done nodes are recorded but never expanded. waitingCount is
// filled (via jira.countWaitingOn) for at most the first 10 open blockers;
// the rest keep waitingCount null with a note. A single unreadable blocker
// is noted and skipped; only a failure to read the starting issue throws.
export async function traceBlockers(jira, issueKey, { maxDepth = 3, maxNodes = 25 } = {}) {
  const notes = [];
  const chain = [];
  const visited = new Set([issueKey]);

  const start = await jira.getIssue(issueKey);
  const queue = [];
  for (const key of blockerKeysOf(start)) {
    if (!visited.has(key)) {
      visited.add(key);
      queue.push({ key, depth: 1 });
    }
  }

  while (queue.length > 0) {
    if (chain.length >= maxNodes) {
      notes.push(`Blocker chain truncated at ${maxNodes} nodes`);
      break;
    }
    const { key, depth } = queue.shift();
    let node;
    try {
      node = await jira.getIssue(key);
    } catch (err) {
      notes.push(`Blocker ${key} could not be read: ${err?.message ?? 'unknown error'}`);
      continue;
    }
    const blockedByKeys = blockerKeysOf(node);
    chain.push({ ...node, depth, waitingCount: null, blockedByKeys });
    if (node.statusCategory !== 'done' && depth < maxDepth) {
      for (const nextKey of blockedByKeys) {
        if (!visited.has(nextKey)) {
          visited.add(nextKey);
          queue.push({ key: nextKey, depth: depth + 1 });
        }
      }
    }
  }

  let lookups = 0;
  let skipped = 0;
  for (const node of chain) {
    if (node.statusCategory === 'done') continue;
    if (lookups >= MAX_WAITING_LOOKUPS) {
      skipped += 1;
      continue;
    }
    lookups += 1;
    try {
      node.waitingCount = await jira.countWaitingOn(node.key);
    } catch (err) {
      node.waitingCount = null;
      notes.push(`Waiting count for ${node.key} could not be read: ${err?.message ?? 'unknown error'}`);
    }
  }
  if (skipped > 0) {
    notes.push(`Waiting counts skipped for ${skipped} blocker(s) (lookup limit ${MAX_WAITING_LOOKUPS})`);
  }

  return { chain, notes };
}
