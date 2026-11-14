// Tracking store for sent unblock requests (CONCEPT.md section 5.3).
// Storage is injected ({ get, set, delete }, async, string keys, JSON values)
// so this module stays testable without @forge/api.
// Records live under `track:<issueKey>`; `track:index` holds the issue keys
// with an active record so the daily watch can list them all.

export const SLA_HOURS = 48;

const INDEX_KEY = 'track:index';

function recordKey(issueKey) {
  return `track:${issueKey}`;
}

async function readIndex(storage) {
  const index = await storage.get(INDEX_KEY);
  return Array.isArray(index) ? index : [];
}

export async function trackRequest(
  storage,
  { issueKey, blockerKey, unblockerAccountId, unblockerName, requestedAt = null },
) {
  const record = {
    issueKey,
    blockerKey,
    unblockerAccountId,
    unblockerName,
    requestedAt: requestedAt ?? new Date().toISOString(),
    slaHours: SLA_HOURS,
    escalatedAt: null,
    status: 'waiting',
  };
  await storage.set(recordKey(issueKey), record);
  const index = await readIndex(storage);
  if (!index.includes(issueKey)) {
    index.push(issueKey);
    await storage.set(INDEX_KEY, index);
  }
  return record;
}

export async function getTracked(storage, issueKey) {
  const record = await storage.get(recordKey(issueKey));
  return record ?? null;
}

export async function listTracked(storage) {
  const index = await readIndex(storage);
  const records = [];
  for (const issueKey of index) {
    const record = await storage.get(recordKey(issueKey));
    if (record) records.push(record);
    // Stale index entries (record gone) are skipped, not resurrected.
  }
  return records;
}

export async function markEscalated(storage, issueKey, at = null) {
  const record = await getTracked(storage, issueKey);
  if (!record) return null;
  record.escalatedAt = at ? new Date(at).toISOString() : new Date().toISOString();
  record.status = 'escalated';
  await storage.set(recordKey(issueKey), record);
  return record;
}

export async function clearTracked(storage, issueKey) {
  const record = await storage.get(recordKey(issueKey));
  const existed = record !== null && record !== undefined;
  await storage.delete(recordKey(issueKey));
  const index = await readIndex(storage);
  const next = index.filter((key) => key !== issueKey);
  if (next.length !== index.length) {
    await storage.set(INDEX_KEY, next);
  }
  return existed;
}
