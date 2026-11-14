// Shared presentational components for the Unjam Custom UI frontends.
// Pure UI: no bridge calls here — data flows in through props.
import React, { useEffect, useState } from 'react';
import { initials } from './format.js';

// ---------------------------------------------------------------------------
// Avatar — Jira avatar image with an initials fallback. The <img> can fail
// (CSP, expired URL, missing avatar); onError swaps to initials, so the UI
// never shows a broken image.
// ---------------------------------------------------------------------------

export function Avatar({ accountId, displayName, avatarUrl, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);
  return (
    <span className={`uj-avatar uj-avatar--${size}`} title={displayName ?? ''}>
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt={displayName ?? ''}
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : (
        initials(displayName)
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ScoreRing — animated SVG ring around a 0-100 score. The ring animates from
// empty on mount (stroke-dashoffset transition) and re-animates on change.
// ---------------------------------------------------------------------------

export function ScoreRing({ value, size = 56, stroke = 5 }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(clamped));
    return () => cancelAnimationFrame(raf);
  }, [clamped]);

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - shown / 100);
  const color =
    clamped >= 70 ? 'var(--uj-score-high)' : clamped >= 40 ? 'var(--uj-score-mid)' : 'var(--uj-score-low)';

  return (
    <span
      className="uj-score-ring"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Match score ${clamped} out of 100`}
    >
      <svg width={size} height={size}>
        <circle
          className="uj-score-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="uj-score-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="uj-score-ring__number" style={{ fontSize: Math.round(size * 0.3) }}>
        {clamped}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar — animated horizontal bar (0-100).
// ---------------------------------------------------------------------------

export function ProgressBar({ value, color }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setWidth(clamped));
    return () => cancelAnimationFrame(raf);
  }, [clamped]);
  return (
    <span className="uj-progress" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <span
        className="uj-progress__bar"
        style={{
          width: `${width}%`,
          background: color ?? 'var(--uj-gradient)',
        }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// CostPill — "Critical · 82" / "Medium · 45" pill, colored by cost label.
// ---------------------------------------------------------------------------

const COST_PILL_CLASS = {
  Critical: 'uj-pill--critical',
  High: 'uj-pill--high',
  Medium: 'uj-pill--medium',
  Low: 'uj-pill--low',
};

export function CostPill({ cost }) {
  if (!cost) return null;
  return (
    <span className={`uj-pill ${COST_PILL_CLASS[cost.label] ?? 'uj-pill--low'}`}>
      <span className="uj-pill__dot" />
      {cost.label} cost · <span className="uj-num">{cost.total}</span>/100
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatusLozenge — Jira status lozenge by status category.
// ---------------------------------------------------------------------------

const LOZENGE_CLASS = {
  done: 'uj-lozenge--success',
  indeterminate: 'uj-lozenge--inprogress',
};

export function StatusLozenge({ status, statusCategory }) {
  return (
    <span className={`uj-lozenge ${LOZENGE_CLASS[statusCategory] ?? 'uj-lozenge--default'}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Banner — titled message box (success / info / warning / danger).
// ---------------------------------------------------------------------------

const BANNER_GLYPH = {
  success: '✓',
  info: 'i',
  warning: '!',
  danger: '!',
};

export function Banner({ appearance = 'info', title, children }) {
  return (
    <div className={`uj-banner uj-banner--${appearance}`} role={appearance === 'danger' ? 'alert' : 'status'}>
      <span className="uj-banner__icon" aria-hidden="true">
        {BANNER_GLYPH[appearance] ?? 'i'}
      </span>
      <div>
        {title ? <div className="uj-banner__title">{title}</div> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / empty / error states.
// ---------------------------------------------------------------------------

export function Spinner({ label }) {
  return (
    <span className="uj-spinner" role="status" aria-label={label ?? 'Loading'} />
  );
}

export function Skeleton({ width = '100%', height = 14, radius = 6 }) {
  return <span className="uj-skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

export function LoadingState({ label }) {
  return (
    <div className="uj-state">
      <Spinner label={label} />
      <div className="uj-muted">{label ?? 'Loading…'}</div>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="uj-state">
      <div className="uj-state__glyph" aria-hidden="true">
        ⚠
      </div>
      <div className="uj-state__title">Something went wrong</div>
      <div className="uj-muted uj-small">{message}</div>
      {onRetry ? (
        <button type="button" className="uj-btn uj-btn--subtle uj-btn--sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ glyph, title, description, children }) {
  return (
    <div className="uj-state">
      {glyph ? (
        <div className="uj-state__glyph" aria-hidden="true">
          {glyph}
        </div>
      ) : null}
      <div className="uj-state__title">{title}</div>
      {description ? <div className="uj-muted uj-small">{description}</div> : null}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoadingButton — a button that shows a spinner while loading.
// ---------------------------------------------------------------------------

export function LoadingButton({
  appearance = 'primary',
  size = '',
  isLoading = false,
  disabled = false,
  onClick,
  children,
  ...rest
}) {
  return (
    <button
      type="button"
      className={`uj-btn uj-btn--${appearance}${size ? ` uj-btn--${size}` : ''}`}
      disabled={disabled || isLoading}
      onClick={onClick}
      {...rest}
    >
      {isLoading ? <span className="uj-btn__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function SectionTitle({ children }) {
  return <div className="uj-section-title">{children}</div>;
}
