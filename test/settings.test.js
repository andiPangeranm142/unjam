// Tests for the admin settings store (src/lib/settings.js).
import {
  DEFAULT_SETTINGS,
  getSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_KEY,
} from '../src/lib/settings.js';
import { makeMapStorage } from './helpers.js';

describe('normalizeSettings', () => {
  it('returns defaults for null, undefined, and non-object input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and drops unknown keys', () => {
    expect(
      normalizeSettings({
        slaHours: 24,
        followUpEnabled: false,
        criticalThreshold: 60,
        surprise: 'ignored',
      }),
    ).toEqual({ slaHours: 24, followUpEnabled: false, criticalThreshold: 60 });
  });

  it('clamps slaHours to 1..720 and rounds', () => {
    expect(normalizeSettings({ slaHours: 0 }).slaHours).toBe(1);
    expect(normalizeSettings({ slaHours: 9999 }).slaHours).toBe(720);
    expect(normalizeSettings({ slaHours: 12.6 }).slaHours).toBe(13);
  });

  it('falls back to the default SLA for non-numeric input', () => {
    expect(normalizeSettings({ slaHours: 'soon' }).slaHours).toBe(48);
    expect(normalizeSettings({ slaHours: NaN }).slaHours).toBe(48);
  });

  it('clamps criticalThreshold to 10..100', () => {
    expect(normalizeSettings({ criticalThreshold: 5 }).criticalThreshold).toBe(10);
    expect(normalizeSettings({ criticalThreshold: 250 }).criticalThreshold).toBe(100);
    expect(normalizeSettings({ criticalThreshold: 'high' }).criticalThreshold).toBe(75);
  });

  it('falls back to follow-up enabled for non-boolean input', () => {
    expect(normalizeSettings({ followUpEnabled: 'yes' }).followUpEnabled).toBe(true);
    expect(normalizeSettings({ followUpEnabled: 0 }).followUpEnabled).toBe(true);
  });

  it('merges partial input with defaults', () => {
    expect(normalizeSettings({ slaHours: 72 })).toEqual({
      slaHours: 72,
      followUpEnabled: true,
      criticalThreshold: 75,
    });
  });
});

describe('getSettings / saveSettings', () => {
  it('returns defaults when nothing is stored', async () => {
    const storage = makeMapStorage();
    await expect(getSettings(storage)).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips normalized settings under the settings key', async () => {
    const storage = makeMapStorage();
    const saved = await saveSettings(storage, {
      slaHours: 24,
      followUpEnabled: false,
      criticalThreshold: 60,
    });
    expect(saved).toEqual({ slaHours: 24, followUpEnabled: false, criticalThreshold: 60 });
    expect(storage.map.get(SETTINGS_KEY)).toEqual(saved);
    await expect(getSettings(storage)).resolves.toEqual(saved);
  });

  it('normalizes on save, so stored data is always valid', async () => {
    const storage = makeMapStorage();
    const saved = await saveSettings(storage, { slaHours: 0, criticalThreshold: 500 });
    expect(saved).toEqual({ slaHours: 1, followUpEnabled: true, criticalThreshold: 100 });
    await expect(getSettings(storage)).resolves.toEqual(saved);
  });

  it('repairs a corrupt stored record on read', async () => {
    const storage = makeMapStorage();
    storage.map.set(SETTINGS_KEY, { slaHours: 'banana', followUpEnabled: 'maybe' });
    await expect(getSettings(storage)).resolves.toEqual(DEFAULT_SETTINGS);
  });
});
