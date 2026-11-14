// Small date/number formatters shared by the Unjam frontends.
// Pure functions, no I/O — kept identical in spirit to the UI Kit panel's
// helpers so behaviour does not change with the rebuild.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export function plural(n, singular, pluralForm = `${singular}s`) {
  return n === 1 ? singular : pluralForm;
}

export function ageDays(isoDate) {
  if (!isoDate) return null;
  const ms = Date.now() - Date.parse(isoDate);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / MS_PER_DAY);
}

// "today" / "1 day" / "12 days" for a creation date.
export function ageText(isoDate) {
  const days = ageDays(isoDate);
  if (days === null) return null;
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

// "Today" / "1 day" / "12 days" for a whole-day count (project board).
export function ageTextFromDays(days) {
  if (typeof days !== 'number' || days < 0) return '—';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

// "just now" / "2h ago" / "3d ago" for the tracking banner.
export function relativeTime(isoDate) {
  if (!isoDate) return '';
  const ms = Date.now() - Date.parse(isoDate);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const hours = Math.floor(ms / MS_PER_HOUR);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(ms / MS_PER_DAY);
  return `${days}d ago`;
}

// "48h" / "24h" / "7 days" for an SLA duration in hours.
export function slaText(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 24) return `${n}h`;
  if (n % 24 === 0) {
    const days = n / 24;
    return `${days} ${plural(days, 'day')}`;
  }
  return `${n}h`;
}

// Initials for the avatar fallback ("Andi Pangeran" -> "AP").
export function initials(displayName) {
  const parts = String(displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
