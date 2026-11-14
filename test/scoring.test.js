import { WEIGHTS, daysBetween, scoreBlockCost, scoreUnblocker } from '../src/lib/scoring.js';

function candidateWith(signals, reasons = []) {
  const full = {};
  for (const key of Object.keys(WEIGHTS)) {
    full[key] = { value: signals[key] ?? 0, source: `${key} evidence` };
  }
  return { accountId: 'u1', displayName: 'Test User', signals: full, reasons };
}

describe('daysBetween', () => {
  test('counts whole days between dates', () => {
    expect(daysBetween('2026-11-01T00:00:00.000Z', '2026-11-08T00:00:00.000Z')).toBe(7);
    expect(daysBetween(new Date('2026-11-01T12:00:00.000Z'), new Date('2026-11-02T11:00:00.000Z'))).toBe(0);
  });

  test('is negative when the second date is earlier', () => {
    expect(daysBetween('2026-11-08T00:00:00.000Z', '2026-11-01T00:00:00.000Z')).toBe(-7);
  });
});

describe('scoreUnblocker', () => {
  test('weights are exactly 35/25/20/10/10', () => {
    expect(WEIGHTS).toEqual({ ownership: 35, expertise: 25, availability: 20, familiarity: 10, team: 10 });
  });

  test('a perfect candidate scores 100 with a full breakdown', () => {
    const result = scoreUnblocker(candidateWith({ ownership: 100, expertise: 100, availability: 100, familiarity: 100, team: 100 }));
    expect(result.total).toBe(100);
    expect(result.breakdown).toEqual({ ownership: 35, expertise: 25, availability: 20, familiarity: 10, team: 10 });
  });

  test('ownership alone (depth-1 assignee) scores 35', () => {
    const result = scoreUnblocker(candidateWith({ ownership: 100 }));
    expect(result.total).toBe(35);
    expect(result.breakdown).toEqual({ ownership: 35, expertise: 0, availability: 0, familiarity: 0, team: 0 });
  });

  test('mixed signals produce a weighted total and a 1-decimal breakdown', () => {
    const result = scoreUnblocker(
      candidateWith({ ownership: 63, expertise: 48, availability: 70, familiarity: 60, team: 0 }),
    );
    // 63% of 35 = 22.05 -> 22.1 or 22.0 (float rounding), 48% of 25 = 12,
    // 70% of 20 = 14, 60% of 10 = 6.
    expect(result.breakdown.ownership).toBeCloseTo(22.05, 0);
    expect(result.breakdown.expertise).toBe(12);
    expect(result.breakdown.availability).toBe(14);
    expect(result.breakdown.familiarity).toBe(6);
    expect(result.breakdown.team).toBe(0);
    expect(result.total).toBe(Math.round(
      result.breakdown.ownership + result.breakdown.expertise + result.breakdown.availability
      + result.breakdown.familiarity + result.breakdown.team,
    ));
  });

  test('signal values are clamped to 0-100', () => {
    const result = scoreUnblocker(candidateWith({ ownership: 250, expertise: -40 }));
    expect(result.total).toBe(35);
  });

  test('missing signals score 0 and reasons pass through', () => {
    const result = scoreUnblocker({ accountId: 'u2', displayName: 'No Signals', reasons: ['Owns the blocking issue ORB-31'] });
    expect(result.total).toBe(0);
    expect(result.reasons).toEqual(['Owns the blocking issue ORB-31']);
  });
});

describe('scoreBlockCost', () => {
  test('age buckets follow the 5/15/25/33/40 scale', () => {
    const base = { waitingCount: 0, dueStatus: 'none', priority: null };
    expect(scoreBlockCost({ ...base, ageDays: 0 }).breakdown.age).toBe(5);
    expect(scoreBlockCost({ ...base, ageDays: 2 }).breakdown.age).toBe(5);
    expect(scoreBlockCost({ ...base, ageDays: 3 }).breakdown.age).toBe(15);
    expect(scoreBlockCost({ ...base, ageDays: 7 }).breakdown.age).toBe(15);
    expect(scoreBlockCost({ ...base, ageDays: 8 }).breakdown.age).toBe(25);
    expect(scoreBlockCost({ ...base, ageDays: 14 }).breakdown.age).toBe(25);
    expect(scoreBlockCost({ ...base, ageDays: 15 }).breakdown.age).toBe(33);
    expect(scoreBlockCost({ ...base, ageDays: 30 }).breakdown.age).toBe(33);
    expect(scoreBlockCost({ ...base, ageDays: 31 }).breakdown.age).toBe(40);
    expect(scoreBlockCost({ ...base, ageDays: 200 }).breakdown.age).toBe(40);
  });

  test('waiting buckets follow the 0/8/16/23/30 scale, null assumes 1', () => {
    const base = { ageDays: 0, dueStatus: 'none', priority: null };
    expect(scoreBlockCost({ ...base, waitingCount: 0 }).breakdown.waiting).toBe(0);
    expect(scoreBlockCost({ ...base, waitingCount: 1 }).breakdown.waiting).toBe(8);
    expect(scoreBlockCost({ ...base, waitingCount: 3 }).breakdown.waiting).toBe(16);
    expect(scoreBlockCost({ ...base, waitingCount: 4 }).breakdown.waiting).toBe(23);
    expect(scoreBlockCost({ ...base, waitingCount: 7 }).breakdown.waiting).toBe(30);
    expect(scoreBlockCost({ ...base, waitingCount: null }).breakdown.waiting).toBe(8);
  });

  test('deadline and priority points follow the spec', () => {
    const base = { ageDays: 0, waitingCount: 0 };
    expect(scoreBlockCost({ ...base, dueStatus: 'overdue', priority: 'Highest' }).breakdown).toMatchObject({ deadline: 20, priority: 10 });
    expect(scoreBlockCost({ ...base, dueStatus: 'dueSoon7', priority: 'High' }).breakdown).toMatchObject({ deadline: 14, priority: 7 });
    expect(scoreBlockCost({ ...base, dueStatus: 'dueSoon30', priority: 'Medium' }).breakdown).toMatchObject({ deadline: 7, priority: 4 });
    expect(scoreBlockCost({ ...base, dueStatus: 'none', priority: 'Low' }).breakdown).toMatchObject({ deadline: 0, priority: 1 });
    expect(scoreBlockCost({ ...base, dueStatus: 'none', priority: 'Lowest' }).breakdown.priority).toBe(1);
    expect(scoreBlockCost({ ...base, dueStatus: 'none', priority: null }).breakdown.priority).toBe(3);
    expect(scoreBlockCost({ ...base, dueStatus: 'none', priority: 'highest' }).breakdown.priority).toBe(10);
  });

  test('labels follow the <25 / 25-49 / 50-74 / 75+ bands', () => {
    // total 5+0+0+3 = 8 -> Low
    expect(scoreBlockCost({ ageDays: 0, waitingCount: 0, dueStatus: 'none', priority: null }).label).toBe('Low');
    // total 15+8+0+3 = 26 -> Medium
    expect(scoreBlockCost({ ageDays: 5, waitingCount: 1, dueStatus: 'none', priority: null }).label).toBe('Medium');
    // total 25+16+7+4 = 52 -> High
    expect(scoreBlockCost({ ageDays: 10, waitingCount: 2, dueStatus: 'dueSoon30', priority: 'Medium' }).label).toBe('High');
    // total 40+30+20+10 = 100 -> Critical
    expect(scoreBlockCost({ ageDays: 40, waitingCount: 9, dueStatus: 'overdue', priority: 'Highest' }).label).toBe('Critical');
  });

  test('label boundaries are exact', () => {
    // 15+0+7+3 = 25 -> Medium (not Low)
    expect(scoreBlockCost({ ageDays: 5, waitingCount: 0, dueStatus: 'dueSoon30', priority: null }).total).toBe(25);
    expect(scoreBlockCost({ ageDays: 5, waitingCount: 0, dueStatus: 'dueSoon30', priority: null }).label).toBe('Medium');
    // 33+0+14+3 = 50 -> High (not Medium)
    expect(scoreBlockCost({ ageDays: 20, waitingCount: 0, dueStatus: 'dueSoon7', priority: null }).total).toBe(50);
    expect(scoreBlockCost({ ageDays: 20, waitingCount: 0, dueStatus: 'dueSoon7', priority: null }).label).toBe('High');
    // 40+23+7+4 = 74 -> High; 40+23+7+7 = 77 -> Critical
    expect(scoreBlockCost({ ageDays: 40, waitingCount: 5, dueStatus: 'dueSoon30', priority: 'Medium' }).label).toBe('High');
    expect(scoreBlockCost({ ageDays: 40, waitingCount: 5, dueStatus: 'dueSoon30', priority: 'High' }).label).toBe('Critical');
  });

  test('reasons explain every contributing factor', () => {
    const result = scoreBlockCost({ ageDays: 12, waitingCount: 3, dueStatus: 'overdue', priority: 'High' });
    expect(result.total).toBe(25 + 16 + 20 + 7);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'Blocked for 12 days',
      '3 issues waiting on this blocker',
      'Past its due date',
      'Priority: High',
    ]));
    const unknown = scoreBlockCost({ ageDays: 1, waitingCount: null, dueStatus: 'none', priority: null });
    expect(unknown.reasons).toContain('Waiting count unknown (assumed 1 issue waiting)');
  });
});
