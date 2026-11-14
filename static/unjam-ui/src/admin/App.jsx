// Admin settings page (jira:adminPage, useAsConfig) — Custom UI.
//
// Reads and writes the Unjam settings (follow-up SLA, automatic
// follow-up, critical cost threshold) through the getSettings /
// saveSettings resolvers. The server normalizes and clamps values, so
// the form still validates client-side: invalid input never enables
// Save, and the values sent are always within the server limits.
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '../shared/bridge.js';
import { plural } from '../shared/format.js';
import { Banner, ErrorState, LoadingButton, Skeleton } from '../shared/components.jsx';

// Matches the server defaults and limits (src/lib/settings.js).
const DEFAULTS = Object.freeze({ slaHours: 48, followUpEnabled: true, criticalThreshold: 75 });
const SLA_LIMITS = Object.freeze({ min: 1, max: 720 });
const THRESHOLD_LIMITS = Object.freeze({ min: 10, max: 100 });

const SLA_PRESETS = [
  { hours: 24, label: '24h' },
  { hours: 48, label: '48h' },
  { hours: 72, label: '72h' },
  { hours: 168, label: '1 week' },
];

// Whole numbers only, within range; anything else is invalid (null).
function parseIntInRange(value, { min, max }) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

// Skeleton form shown while the first load is in flight: it holds the
// layout of the hero card and the three settings sections.
function SettingsSkeleton() {
  return (
    <div className="uj-stack uj-stack--loose" aria-hidden="true">
      <div className="uj-card uj-card--hero uj-stack uj-stack--tight">
        <Skeleton width={180} height={24} />
        <Skeleton width="80%" height={14} />
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} className="uj-card uj-stack">
          <Skeleton width={160} height={16} />
          <Skeleton width={110} height={36} />
          <Skeleton width="70%" height={14} />
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [slaInput, setSlaInput] = useState(String(DEFAULTS.slaHours));
  const [followUp, setFollowUp] = useState(DEFAULTS.followUpEnabled);
  const [thresholdInput, setThresholdInput] = useState(String(DEFAULTS.criticalThreshold));

  const applySettings = useCallback((settings) => {
    setSaved(settings);
    setSlaInput(String(settings.slaHours));
    setFollowUp(settings.followUpEnabled);
    setThresholdInput(String(settings.criticalThreshold));
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await invoke('getSettings', {});
      if (response?.error) {
        setLoadError(response.error);
      } else if (response?.settings) {
        applySettings(response.settings);
      } else {
        setLoadError('Settings could not be loaded.');
      }
    } catch (err) {
      setLoadError(err?.message || 'Something went wrong while loading settings.');
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const slaValue = parseIntInRange(slaInput, SLA_LIMITS);
  const thresholdValue = parseIntInRange(thresholdInput, THRESHOLD_LIMITS);
  const slaValid = slaValue !== null;
  const thresholdValid = thresholdValue !== null;
  const isValid = slaValid && thresholdValid;
  const dirty =
    saved !== null &&
    ((slaValid && slaValue !== saved.slaHours) ||
      followUp !== saved.followUpEnabled ||
      (thresholdValid && thresholdValue !== saved.criticalThreshold));

  const clearNotices = () => {
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleSlaChange = (event) => {
    setSlaInput(event.target.value);
    clearNotices();
  };

  const handleFollowUpChange = (event) => {
    setFollowUp(event.target.checked);
    clearNotices();
  };

  const handleThresholdChange = (event) => {
    setThresholdInput(event.target.value);
    clearNotices();
  };

  const handleReset = () => {
    setSlaInput(String(DEFAULTS.slaHours));
    setFollowUp(DEFAULTS.followUpEnabled);
    setThresholdInput(String(DEFAULTS.criticalThreshold));
    clearNotices();
  };

  const handleSave = async () => {
    if (!dirty || !isValid || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const response = await invoke('saveSettings', {
        settings: {
          slaHours: slaValue,
          followUpEnabled: followUp,
          criticalThreshold: thresholdValue,
        },
      });
      if (response?.error) {
        setSaveError(response.error);
      } else if (response?.settings) {
        // The server returns the normalized settings; adopt them so the
        // form always reflects what is actually stored.
        applySettings(response.settings);
        setSaveSuccess(true);
      } else {
        setSaveError('Settings could not be saved.');
      }
    } catch (err) {
      setSaveError(err?.message || 'Something went wrong while saving settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !saved) {
    return (
      <div className="uj-root uj-root--wide">
        <SettingsSkeleton />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="uj-root uj-root--wide">
        <ErrorState message={loadError} onRetry={fetchSettings} />
      </div>
    );
  }

  if (!saved) return null;

  const slaPreview = !followUp
    ? 'Automatic follow-up is off, so no follow-up will be posted.'
    : slaValid
      ? `Requests will be followed up after ${slaValue} ${plural(slaValue, 'hour')} if the blocker is still open.`
      : 'Enter a valid SLA to see the follow-up preview.';
  // The slider always shows a valid number: the parsed input, or the
  // saved value while the input is temporarily invalid.
  const sliderValue = thresholdValue ?? saved.criticalThreshold;

  return (
    <div className="uj-root uj-root--wide">
      <div className="uj-stack uj-stack--loose">
        <div className="uj-card uj-card--hero uj-fade-up">
          <h1 className="uj-heading uj-heading--lg">Unjam settings</h1>
          <p className="uj-muted" style={{ margin: '6px 0 0' }}>
            Control how Unjam follows up on blocked work, and which blockers count as critical.
          </p>
        </div>

        {saveSuccess ? <Banner appearance="success">Settings saved.</Banner> : null}
        {saveError ? <Banner appearance="danger">{saveError}</Banner> : null}

        <section className="uj-card uj-stack uj-fade-up" style={{ '--uj-delay': '60ms' }}>
          <div className="uj-field">
            <label className="uj-label" htmlFor="uj-sla">
              Follow-up SLA
            </label>
            <div className="uj-row uj-row--wrap">
              <input
                id="uj-sla"
                className="uj-input uj-input--inline"
                type="number"
                min={SLA_LIMITS.min}
                max={SLA_LIMITS.max}
                step="1"
                inputMode="numeric"
                value={slaInput}
                onChange={handleSlaChange}
                aria-describedby="uj-sla-hint uj-sla-preview"
              />
              <span className="uj-muted">hours</span>
            </div>
            <div className="uj-row uj-row--wrap" role="group" aria-label="SLA presets">
              {SLA_PRESETS.map((preset) => (
                <button
                  key={preset.hours}
                  type="button"
                  className="uj-btn uj-btn--subtle uj-btn--sm"
                  style={
                    slaValue === preset.hours
                      ? { background: 'var(--uj-bg-selected)', color: 'var(--uj-text-brand)' }
                      : undefined
                  }
                  aria-pressed={slaValue === preset.hours}
                  onClick={() => {
                    setSlaInput(String(preset.hours));
                    clearNotices();
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="uj-hint" id="uj-sla-hint" style={{ margin: 0 }}>
              How long Unjam waits for a reply before posting an automatic follow-up on the blocker.
            </p>
            {!slaValid ? (
              <p className="uj-small" style={{ margin: 0, color: 'var(--uj-text-danger)' }} role="alert">
                Enter a whole number between {SLA_LIMITS.min} and {SLA_LIMITS.max} hours.
              </p>
            ) : null}
            <p className="uj-small uj-muted" id="uj-sla-preview" style={{ margin: 0 }} aria-live="polite">
              {slaPreview}
            </p>
          </div>
        </section>

        <section className="uj-card uj-stack uj-fade-up" style={{ '--uj-delay': '120ms' }}>
          <div className="uj-field">
            <span className="uj-label" id="uj-followup-label">
              Automatic follow-up
            </span>
            <label className="uj-toggle">
              <input
                type="checkbox"
                checked={followUp}
                onChange={handleFollowUpChange}
                aria-labelledby="uj-followup-label"
              />
              <span className="uj-toggle__track" aria-hidden="true" />
              <span>{followUp ? 'On' : 'Off'}</span>
            </label>
            <p className="uj-hint" style={{ margin: 0 }}>
              When off, overdue requests are never escalated. Resolved blocks are still cleared automatically.
            </p>
          </div>
        </section>

        <section className="uj-card uj-stack uj-fade-up" style={{ '--uj-delay': '180ms' }}>
          <div className="uj-field">
            <label className="uj-label" htmlFor="uj-threshold">
              Critical cost threshold
            </label>
            <div className="uj-row uj-row--wrap">
              <input
                id="uj-threshold"
                className="uj-input uj-input--inline"
                type="number"
                min={THRESHOLD_LIMITS.min}
                max={THRESHOLD_LIMITS.max}
                step="1"
                inputMode="numeric"
                value={thresholdInput}
                onChange={handleThresholdChange}
                aria-describedby="uj-threshold-hint"
              />
              <span className="uj-muted">out of 100</span>
            </div>
            <div className="uj-row">
              <input
                type="range"
                min={THRESHOLD_LIMITS.min}
                max={THRESHOLD_LIMITS.max}
                step="1"
                value={sliderValue}
                onChange={handleThresholdChange}
                aria-label="Critical cost threshold"
                style={{ flex: 1, accentColor: 'var(--uj-accent)' }}
              />
              <span className="uj-num uj-strong" style={{ minWidth: 32, textAlign: 'right' }}>
                {thresholdValue ?? '—'}
              </span>
            </div>
            <p className="uj-hint" id="uj-threshold-hint" style={{ margin: 0 }}>
              Blockers scoring at or above this cost count as “critical” on the Blocked Work board.
            </p>
            {!thresholdValid ? (
              <p className="uj-small" style={{ margin: 0, color: 'var(--uj-text-danger)' }} role="alert">
                Enter a whole number between {THRESHOLD_LIMITS.min} and {THRESHOLD_LIMITS.max}.
              </p>
            ) : null}
          </div>
        </section>

        <Banner appearance="info">
          Settings apply to requests sent after saving. Requests already in flight keep the SLA they were sent
          with.
        </Banner>

        <div className="uj-row uj-row--spread uj-row--wrap">
          <button type="button" className="uj-btn uj-btn--subtle" onClick={handleReset}>
            Reset to defaults
          </button>
          <LoadingButton
            appearance="primary"
            isLoading={saving}
            disabled={!dirty || !isValid}
            onClick={handleSave}
          >
            Save settings
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
