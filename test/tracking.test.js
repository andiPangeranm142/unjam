import { SLA_HOURS, clearTracked, getTracked, listTracked, markEscalated, trackRequest } from '../src/lib/tracking.js';
import { makeMapStorage } from './helpers.js';

const REQUEST = {
  issueKey: 'ORB-45',
  blockerKey: 'ORB-31',
  unblockerAccountId: 'u-priya',
  unblockerName: 'Priya Nair',
};

describe('tracking store', () => {
  test('SLA is 48 hours', () => {
    expect(SLA_HOURS).toBe(48);
  });

  test('trackRequest stores a waiting record and maintains the index', async () => {
    const storage = makeMapStorage();
    const record = await trackRequest(storage, REQUEST);

    expect(record).toMatchObject({
      ...REQUEST,
      slaHours: 48,
      escalatedAt: null,
      status: 'waiting',
    });
    expect(new Date(record.requestedAt).getTime()).not.toBeNaN();
    expect(storage.map.get('track:ORB-45')).toEqual(record);
    expect(storage.map.get('track:index')).toEqual(['ORB-45']);
  });

  test('tracking the same issue twice does not duplicate the index entry', async () => {
    const storage = makeMapStorage();
    await trackRequest(storage, REQUEST);
    await trackRequest(storage, { ...REQUEST, blockerKey: 'ORB-42' });
    expect(storage.map.get('track:index')).toEqual(['ORB-45']);
    expect((await getTracked(storage, 'ORB-45')).blockerKey).toBe('ORB-42');
  });

  test('getTracked returns null for an untracked issue', async () => {
    const storage = makeMapStorage();
    expect(await getTracked(storage, 'ORB-99')).toBeNull();
  });

  test('listTracked returns all records in tracking order', async () => {
    const storage = makeMapStorage();
    await trackRequest(storage, REQUEST);
    await trackRequest(storage, { ...REQUEST, issueKey: 'ORB-38', blockerKey: 'ORB-27' });
    const records = await listTracked(storage);
    expect(records.map((r) => r.issueKey)).toEqual(['ORB-45', 'ORB-38']);
  });

  test('listTracked skips stale index entries without crashing', async () => {
    const storage = makeMapStorage();
    await trackRequest(storage, REQUEST);
    await storage.set('track:index', ['ORB-45', 'ORB-38']); // ORB-38 has no record
    const records = await listTracked(storage);
    expect(records.map((r) => r.issueKey)).toEqual(['ORB-45']);
  });

  test('markEscalated flips status and stamps the time', async () => {
    const storage = makeMapStorage();
    await trackRequest(storage, REQUEST);
    const escalated = await markEscalated(storage, 'ORB-45', '2026-11-14T10:00:00.000Z');
    expect(escalated.status).toBe('escalated');
    expect(escalated.escalatedAt).toBe('2026-11-14T10:00:00.000Z');
    expect((await getTracked(storage, 'ORB-45')).status).toBe('escalated');
  });

  test('markEscalated returns null for an untracked issue', async () => {
    const storage = makeMapStorage();
    expect(await markEscalated(storage, 'ORB-99')).toBeNull();
  });

  test('clearTracked removes the record and its index entry, returns true', async () => {
    const storage = makeMapStorage();
    await trackRequest(storage, REQUEST);
    await trackRequest(storage, { ...REQUEST, issueKey: 'ORB-38', blockerKey: 'ORB-27' });
    expect(await clearTracked(storage, 'ORB-45')).toBe(true);
    expect(await getTracked(storage, 'ORB-45')).toBeNull();
    expect(storage.map.get('track:index')).toEqual(['ORB-38']);
    expect(await listTracked(storage)).toHaveLength(1);
  });

  test('clearTracked returns false for an untracked issue and still cleans the index', async () => {
    const storage = makeMapStorage();
    await storage.set('track:index', ['ORB-45']);
    expect(await clearTracked(storage, 'ORB-45')).toBe(false);
    expect(storage.map.get('track:index')).toEqual([]);
  });
});
