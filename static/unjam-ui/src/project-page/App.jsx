// Project page — blocked-work board (Custom UI).
//
// Rebuild of the UI Kit project page (see the uikit-fallback branch):
// all blocked work in the project, costliest first, with the top
// unblocker for each pair. All data comes from the getProjectBlocks
// resolver; nothing here is hardcoded.
//
// Behaviour carried over from the UI Kit page:
// - one row per (issue, blocker) pair — an issue with two open blockers
//   appears twice — keyed `${issue.key}::${blocker.key}`;
// - issue keys navigate via router.navigate (openIssue): plain <a href>
//   links are blocked inside the Forge iframe;
// - the header summary, the empty state, and the notes section are
//   verbatim from the old page.
// One deliberate change: "critical" now means cost.total at or above the
// admin-configurable criticalThreshold, not the fixed 'Critical' label.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getContext, invoke, openIssue } from '../shared/bridge.js';
import { ageTextFromDays, relativeTime } from '../shared/format.js';
import {
  Avatar,
  CostPill,
  EmptyState,
  ErrorState,
  LoadingButton,
  LoadingState,
  SectionTitle,
  Skeleton,
} from '../shared/components.jsx';
import './project-page.css';

const PAGE_SIZE = 15;
// Matches the server default (src/lib/settings.js) when the response
// carries no settings object.
const DEFAULT_CRITICAL_THRESHOLD = 75;

const SORTS = [
  { value: 'cost', label: 'Costliest first' },
  { value: 'age', label: 'Oldest first' },
  { value: 'waiting', label: 'Most waiting first' },
];

// Sort keys: missing values sort last (-1 is below every real value).
function costOf(block) {
  return typeof block?.cost?.total === 'number' ? block.cost.total : -1;
}

function ageOf(block) {
  return typeof block?.ageDays === 'number' ? block.ageDays : -1;
}

function waitingOf(block) {
  return typeof block?.waitingCount === 'number' ? block.waitingCount : -1;
}

function matchesFilter(block, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [block?.issue?.key, block?.issue?.summary, block?.blocker?.key, block?.blocker?.summary].some(
    (text) => String(text ?? '').toLowerCase().includes(q),
  );
}

function IssueCell({ issue }) {
  return (
    <div className="pp-cell-main">
      <button type="button" className="uj-link" onClick={() => openIssue(issue.key)}>
        {issue.key}
      </button>
      <span className="uj-muted uj-small pp-summary">{issue.summary}</span>
    </div>
  );
}

function StatCard({ delay, value, label, sub, danger }) {
  return (
    <div className="uj-card pp-stat uj-fade-up" style={{ '--uj-delay': delay }}>
      <span className="pp-stat__number" style={danger ? { color: 'var(--uj-text-danger)' } : undefined}>
        {value}
      </span>
      <span className="pp-stat__label">{label}</span>
      <span className="pp-stat__sub">{sub}</span>
    </div>
  );
}

// Skeleton board shown while the first fetch is in flight: it holds the
// layout of the header, stat cards, and table rows so nothing jumps.
function BoardSkeleton() {
  return (
    <div className="uj-stack uj-stack--loose" aria-hidden="true">
      <div className="uj-stack uj-stack--tight">
        <Skeleton width={180} height={24} />
        <Skeleton width={340} height={14} />
      </div>
      <div className="pp-stats">
        {[0, 1, 2].map((index) => (
          <div key={index} className="uj-card pp-stat">
            <Skeleton width={48} height={28} />
            <Skeleton width={90} height={14} />
            <Skeleton width={140} height={12} />
          </div>
        ))}
      </div>
      <div className="uj-card pp-board-card">
        <div className="pp-board-scroll">
          <table className="pp-board">
            <thead>
              <tr>
                <th>Waiting issue</th>
                <th>Blocked by</th>
                <th>Age</th>
                <th>Waiting</th>
                <th>Cost</th>
                <th>Top unblocker</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((row) => (
                <tr key={row}>
                  <td>
                    <Skeleton width={170} height={14} />
                  </td>
                  <td>
                    <Skeleton width={170} height={14} />
                  </td>
                  <td>
                    <Skeleton width={52} height={14} />
                  </td>
                  <td>
                    <Skeleton width={24} height={14} />
                  </td>
                  <td>
                    <Skeleton width={110} height={22} radius={999} />
                  </td>
                  <td>
                    <Skeleton width={120} height={24} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [contextState, setContextState] = useState('resolving'); // resolving | ready | error
  const [contextError, setContextError] = useState(null);
  const [projectKey, setProjectKey] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('cost');
  const [filter, setFilter] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const fetchBlocks = useCallback(async (key) => {
    setLoading(true);
    setError(null);
    try {
      const response = await invoke('getProjectBlocks', { projectKey: key });
      if (response?.error) {
        setError(response.error);
        setResult(null);
      } else {
        setResult(response);
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong while loading blocked work.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getContext()
      .then((context) => {
        if (cancelled) return;
        setProjectKey(context?.extension?.project?.key ?? null);
        setContextState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setContextError(err?.message || 'Could not load the project context.');
        setContextState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (projectKey) fetchBlocks(projectKey);
  }, [projectKey, fetchBlocks]);

  const blocks = result?.blocks ?? [];
  const threshold = result?.settings?.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD;
  const criticalCount = blocks.filter(
    (block) => typeof block?.cost?.total === 'number' && block.cost.total >= threshold,
  ).length;

  // Filter first, then sort; the original (costliest-first) order breaks
  // ties so every sort is stable.
  const sortedBlocks = useMemo(() => {
    const indexed = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => matchesFilter(block, filter));
    const byIndex = (a, b) => a.index - b.index;
    if (sort === 'age') {
      indexed.sort((a, b) => ageOf(b.block) - ageOf(a.block) || byIndex(a, b));
    } else if (sort === 'waiting') {
      indexed.sort((a, b) => waitingOf(b.block) - waitingOf(a.block) || byIndex(a, b));
    } else {
      indexed.sort((a, b) => costOf(b.block) - costOf(a.block) || byIndex(a, b));
    }
    return indexed.map(({ block }) => block);
  }, [blocks, sort, filter]);

  const visibleBlocks = sortedBlocks.slice(0, visibleCount);
  const updatedText = result?.generatedAt ? relativeTime(result.generatedAt) : '';

  const handleFilterChange = (event) => {
    setFilter(event.target.value);
    setVisibleCount(PAGE_SIZE);
  };

  if (contextState === 'resolving') {
    return (
      <div className="uj-root uj-root--wide">
        <LoadingState label="Loading project context…" />
      </div>
    );
  }

  if (contextState === 'error') {
    return (
      <div className="uj-root uj-root--wide">
        <ErrorState message={contextError} />
      </div>
    );
  }

  if (!projectKey) {
    return (
      <div className="uj-root uj-root--wide">
        <ErrorState message="Could not determine the current project. Reopen this page from a project." />
      </div>
    );
  }

  if (loading && !result) {
    return (
      <div className="uj-root uj-root--wide">
        <BoardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="uj-root uj-root--wide">
        <ErrorState message={error} onRetry={() => fetchBlocks(projectKey)} />
      </div>
    );
  }

  if (!result) return null;

  const summary = `${result.blockedCount} blocked · ${criticalCount} critical · ${result.totalOpen} open issues — costliest blockers first.`;

  return (
    <div className="uj-root uj-root--wide">
      <div className="uj-stack uj-stack--loose">
        <div className="uj-stack uj-stack--tight uj-fade-up">
          <div className="uj-row uj-row--spread uj-row--wrap">
            <h1 className="uj-heading uj-heading--lg">Blocked work</h1>
            <div className="uj-row">
              {updatedText ? <span className="uj-muted uj-small">Updated {updatedText}</span> : null}
              <LoadingButton
                appearance="subtle"
                size="sm"
                isLoading={loading}
                onClick={() => fetchBlocks(projectKey)}
              >
                Refresh
              </LoadingButton>
            </div>
          </div>
          <p className="uj-muted" style={{ margin: 0 }}>
            {summary}
          </p>
        </div>

        <div className="pp-stats">
          <StatCard
            delay="0ms"
            value={result.blockedCount}
            label="Blocked"
            sub="issues waiting on another issue"
          />
          <StatCard
            delay="60ms"
            value={criticalCount}
            label="Critical"
            sub={`cost at or above ${threshold}`}
            danger={criticalCount > 0}
          />
          <StatCard
            delay="120ms"
            value={result.totalOpen}
            label="Open issues"
            sub={`in ${result.projectKey}`}
          />
        </div>

        {blocks.length === 0 ? (
          <div className="uj-card uj-fade-up" style={{ '--uj-delay': '160ms' }}>
            <EmptyState
              glyph="✓"
              title="No blocked work"
              description="Nothing in this project is waiting on another issue right now. To try Unjam, create two issues and link one to the other with “is blocked by”, then come back here."
            />
          </div>
        ) : (
          <div className="uj-stack uj-fade-up" style={{ '--uj-delay': '160ms' }}>
            <div className="pp-controls">
              <input
                type="search"
                className="uj-input"
                value={filter}
                onChange={handleFilterChange}
                placeholder="Filter by key or summary…"
                aria-label="Filter blocked work by issue or blocker key or summary"
              />
              <select
                className="uj-select"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label="Sort blocked work"
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="uj-card pp-board-card">
              {sortedBlocks.length === 0 ? (
                <EmptyState
                  glyph="🔍"
                  title="No rows match your filter"
                  description="Try a different key or summary text."
                >
                  <button type="button" className="uj-btn uj-btn--subtle uj-btn--sm" onClick={() => setFilter('')}>
                    Clear filter
                  </button>
                </EmptyState>
              ) : (
                <>
                  <div className="pp-board-scroll">
                    <table className="pp-board">
                      <thead>
                        <tr>
                          <th>Waiting issue</th>
                          <th>Blocked by</th>
                          <th>Age</th>
                          <th>Waiting</th>
                          <th>Cost</th>
                          <th>Top unblocker</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleBlocks.map((block) => (
                          <tr key={`${block.issue.key}::${block.blocker.key}`}>
                            <td>
                              <IssueCell issue={block.issue} />
                            </td>
                            <td>
                              <IssueCell issue={block.blocker} />
                            </td>
                            <td className="uj-num">{ageTextFromDays(block.ageDays)}</td>
                            <td className="uj-num">
                              {typeof block.waitingCount === 'number' ? block.waitingCount : '—'}
                            </td>
                            <td>{block.cost ? <CostPill cost={block.cost} /> : <span className="uj-muted">—</span>}</td>
                            <td>
                              {block.topUnblocker ? (
                                <span className="pp-unblocker">
                                  <Avatar
                                    size="sm"
                                    accountId={block.topUnblocker.accountId}
                                    displayName={block.topUnblocker.displayName}
                                    avatarUrl={block.topUnblocker.avatarUrl}
                                  />
                                  <span>{block.topUnblocker.displayName}</span>
                                </span>
                              ) : (
                                <span className="uj-muted">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pp-board-footer">
                    <span className="uj-muted uj-small">
                      Showing {visibleBlocks.length} of {sortedBlocks.length}
                      {filter.trim() ? ' matching rows' : ' blocked pairs'}
                    </span>
                    {visibleBlocks.length < sortedBlocks.length ? (
                      <button
                        type="button"
                        className="uj-btn uj-btn--subtle uj-btn--sm"
                        onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                      >
                        Show more
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {result.notes && result.notes.length > 0 && (
          <div className="uj-stack uj-stack--tight">
            <SectionTitle>Notes</SectionTitle>
            {result.notes.map((note, index) => (
              <p key={`note-${index}`} className="uj-muted uj-small" style={{ margin: 0 }}>
                {note}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
