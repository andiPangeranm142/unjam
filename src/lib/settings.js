// Admin-configurable Unjam settings (CONCEPT.md section 5.3: SLA settings).
// Stored in app KVS under a single key; the admin settings page reads and
// writes them through the getSettings/saveSettings resolver methods, and the
// send + daily-watch paths read them so behaviour follows the admin's
// choices. Storage is injected ({ get, set }, async, string keys, JSON
// values) so this module stays testable without @forge/api.

export const SETTINGS_KEY = 'settings:sla';

// Defaults match v1 behaviour exactly: a 48-hour SLA, automatic follow-up
// enabled, and the fixed "Critical" cost band (75+) as the board threshold.
export const DEFAULT_SETTINGS = Object.freeze({
  slaHours: 48,
  followUpEnabled: true,
  criticalThreshold: 75,
});

export const LIMITS = Object.freeze({
  slaHours: { min: 1, max: 720 },
  criticalThreshold: { min: 10, max: 100 },
});

function clampInt(value, { min, max }, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Normalize any stored or submitted input into a complete, valid settings
// object. Unknown keys are dropped; invalid values fall back to defaults,
// so a corrupt or partial record can never break the send/watch paths.
export function normalizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    slaHours: clampInt(src.slaHours, LIMITS.slaHours, DEFAULT_SETTINGS.slaHours),
    followUpEnabled:
      typeof src.followUpEnabled === 'boolean'
        ? src.followUpEnabled
        : DEFAULT_SETTINGS.followUpEnabled,
    criticalThreshold: clampInt(
      src.criticalThreshold,
      LIMITS.criticalThreshold,
      DEFAULT_SETTINGS.criticalThreshold,
    ),
  };
}

export async function getSettings(storage) {
  const stored = await storage.get(SETTINGS_KEY);
  return normalizeSettings(stored);
}

export async function saveSettings(storage, input) {
  const settings = normalizeSettings(input);
  await storage.set(SETTINGS_KEY, settings);
  return settings;
}
