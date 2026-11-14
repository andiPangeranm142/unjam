// Issue panel (Custom UI, React 18 + Vite).
//
// Behaviour mirrors the UI Kit panel exactly (git branch `uikit-fallback`,
// unjam/src/frontend/issue-panel.jsx): same resolver calls, states,
// sections and copy — rebuilt on the shared design system. All data comes
// from the resolver; nothing here is hardcoded.
import { useEffect, useState } from 'react';
import { getContext, invoke, openIssue } from '../shared/bridge.js';
import { ageText, plural, relativeTime, slaText } from '../shared/format.js';
import {
  Avatar,
  Banner,
  CostPill,
  EmptyState,
  ErrorState,
  LoadingButton,
  LoadingState,
  ProgressBar,
  ScoreRing,
  SectionTitle,
  Skeleton,
  StatusLozenge,
} from '../shared/components.jsx';
import './issue-panel.css';

// Score breakdown signals and their max points (must match the resolver).
const SCORE_SIGNALS = [
  { key: 'ownership', label: 'Ownership', max: 35 },
  { key: 'expertise', label: 'Expertise', max: 25 },
  { key: 'availability', label: 'Availability', max: 20 },
  { key: 'familiarity', label: 'Familiarity', max: 10 },
  { key: 'team', label: 'Team', max: 10 },
];

// Cost breakdown signals and their max points (must match the resolver).
const COST_SIGNALS = [
  { key: 'age', label: 'Blocker age', max: 40 },
  { key: 'waiting', label: 'Issues waiting', max: 30 },
  { key: 'deadline', label: 'Deadline pressure', max: 20 },
  { key: 'priority', label: 'Priority', max: 10 },
];

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

// Smooth expand/collapse wrapper (grid-rows trick — animates to content height).
function Expandable({ open, children }) {
  return (
    <div className={`uj-expand${open ? ' uj-expand--open' : ''}`}>
      <div className="uj-expand__inner">{children}</div>
    </div>
  );
}

// One labelled mini-bar: "Ownership · 28 / 35" over a progress bar.
function MiniBar({ label, value, max }) {
  const points = Number(value) || 0;
  return (
    <div className="uj-mini-bar">
      <div className="uj-row uj-row--spread">
        <span className="uj-small uj-muted">{label}</span>
        <span className="uj-small uj-num uj-strong">
          {points}
          <span className="uj-muted"> / {max}</span>
        </span>
      </div>
      <ProgressBar value={(points / max) * 100} />
    </div>
  );
}

// Skeleton layout that mimics the blocked view while the plan loads.
function PlanSkeleton() {
  return (
    <div className="uj-root">
      <div className="uj-stack uj-stack--loose">
        <div className="uj-card uj-card--hero">
          <div className="uj-stack uj-stack--tight">
            <Skeleton width="55%" height={18} />
            <Skeleton width="80%" height={14} />
            <Skeleton width="40%" height={14} />
          </div>
        </div>
        <div className="uj-stack uj-stack--tight">
          <Skeleton width="45%" height={12} />
          {[0, 1].map((index) => (
            <div key={`candidate-skeleton-${index}`} className="uj-card">
              <div className="uj-stack uj-stack--tight">
                <div className="uj-row">
                  <Skeleton width={32} height={32} radius={16} />
                  <Skeleton width="50%" height={14} />
                </div>
                <Skeleton width="100%" height={6} radius={3} />
                <Skeleton width="75%" height={12} />
              </div>
            </div>
          ))}
        </div>
        <div className="uj-stack uj-stack--tight">
          <Skeleton width="35%" height={12} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="90%" height={14} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero — "Blocked by X", cost pill, age/waiting summary, expandable cost.
// ---------------------------------------------------------------------------

function Hero({ plan, nearestBlocker, summaryParts, delay }) {
  const [expanded, setExpanded] = useState(false);
  const { cost } = plan;
  return (
    <div className="uj-card uj-card--hero uj-fade-up" style={{ '--uj-delay': `${delay}ms` }}>
      <div className="uj-stack uj-stack--tight">
        <h2 className="uj-heading">Blocked by {nearestBlocker.key}</h2>
        <div className="uj-row uj-row--wrap">
          {cost ? <CostPill cost={cost} /> : null}
          {summaryParts.length > 0 ? (
            <span className="uj-small uj-muted">{summaryParts.join(' · ')}</span>
          ) : null}
        </div>
        <p className="uj-small uj-muted" style={{ margin: 0 }}>
          {nearestBlocker.summary}
        </p>
        {cost ? (
          <div>
            <button
              type="button"
              className="uj-link uj-small"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? '▾ Hide cost breakdown' : '▸ Why this cost'}
            </button>
            <Expandable open={expanded}>
              <div className="uj-breakdown">
                {COST_SIGNALS.map((signal) => (
                  <MiniBar
                    key={signal.key}
                    label={signal.label}
                    value={cost.breakdown?.[signal.key]}
                    max={signal.max}
                  />
                ))}
                {(cost.reasons ?? []).map((reason, index) => (
                  <div key={`cost-reason-${index}`} className="uj-small uj-muted">
                    {reason}
                  </div>
                ))}
              </div>
            </Expandable>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CandidateCard — avatar + name + score ring, progress bar, reasons,
// expandable "Why this score" breakdown, send button.
// ---------------------------------------------------------------------------

function CandidateCard({ candidate, delay, sendingAccountId, onSend }) {
  const [expanded, setExpanded] = useState(false);
  const isSending = sendingAccountId === candidate.accountId;
  return (
    <div className="uj-card uj-fade-up" style={{ '--uj-delay': `${delay}ms` }}>
      <div className="uj-stack uj-stack--tight">
        <div className="uj-row">
          <Avatar
            accountId={candidate.accountId}
            displayName={candidate.displayName}
            avatarUrl={candidate.avatarUrl}
            size="md"
          />
          <span
            className="uj-strong"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {candidate.displayName}
          </span>
          <ScoreRing value={candidate.total} size={48} />
        </div>
        <ProgressBar value={candidate.total} />
        {(candidate.reasons ?? []).map((reason, index) => (
          <div key={`${candidate.accountId}-reason-${index}`} className="uj-small uj-muted">
            {reason}
          </div>
        ))}
        <div>
          <button
            type="button"
            className="uj-link uj-small"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? '▾ Hide score breakdown' : '▸ Why this score'}
          </button>
          <Expandable open={expanded}>
            <div className="uj-breakdown">
              {SCORE_SIGNALS.map((signal) => (
                <MiniBar
                  key={signal.key}
                  label={signal.label}
                  value={candidate.breakdown?.[signal.key]}
                  max={signal.max}
                />
              ))}
            </div>
          </Expandable>
        </div>
        <LoadingButton
          appearance="primary"
          size="block"
          isLoading={isSending}
          disabled={sendingAccountId !== null}
          onClick={() => onSend(candidate)}
        >
          Send request
        </LoadingButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [context, setContext] = useState(null);
  const [contextReady, setContextReady] = useState(false);
  const [contextError, setContextError] = useState(false);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sendingAccountId, setSendingAccountId] = useState(null);
  const [success, setSuccess] = useState(null);
  const [sendError, setSendError] = useState(null);

  const issueKey = context?.extension?.issue?.key;

  const resolveContext = () => {
    setContextReady(false);
    setContextError(false);
    getContext().then(
      (ctx) => {
        setContext(ctx ?? null);
        setContextReady(true);
      },
      () => {
        setContextError(true);
        setContextReady(true);
      },
    );
  };

  useEffect(() => {
    resolveContext();
  }, []);

  const fetchPlan = async (key, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await invoke('getUnblockPlan', { issueKey: key });
      if (result?.error) {
        setError(result.error);
        setPlan(null);
      } else {
        setPlan(result);
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong while loading the unblock plan.');
      setPlan(null);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (issueKey) fetchPlan(issueKey);
    // fetchPlan is stable in behaviour; re-fetch only when the issue changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey]);

  const sendRequest = async (unblocker) => {
    if (!plan || !plan.openBlockers || plan.openBlockers.length === 0) return;
    const blocker = plan.openBlockers[0];
    setSendingAccountId(unblocker.accountId);
    setSendError(null);
    setSuccess(null);
    try {
      const result = await invoke('sendRequest', {
        issueKey: plan.issue.key,
        blockerKey: blocker.key,
        unblockerAccountId: unblocker.accountId,
      });
      if (result?.error) {
        setSendError(result.error);
      } else {
        // SLA comes from the tracking object the resolver just created —
        // never hardcoded. If tracking could not be saved, the resolver
        // returns tracking: null and the follow-up clause is omitted.
        const slaHours = result?.tracking?.slaHours;
        const sla = slaText(slaHours);
        setSuccess(
          sla
            ? `Request sent to ${unblocker.displayName} on ${blocker.key}. ` +
                `We'll follow up if there's no reply within ${sla}.`
            : `Request sent to ${unblocker.displayName} on ${blocker.key}.`,
        );
        await fetchPlan(plan.issue.key, { silent: true });
      }
    } catch (err) {
      setSendError(err?.message || 'Something went wrong while sending the request.');
    } finally {
      setSendingAccountId(null);
    }
  };

  // Context still resolving.
  if (!contextReady) {
    return (
      <div className="uj-root">
        <LoadingState label="Loading…" />
      </div>
    );
  }

  if (contextError) {
    return (
      <div className="uj-root">
        <ErrorState message="Could not load the issue context." onRetry={resolveContext} />
      </div>
    );
  }

  if (!issueKey) {
    return (
      <div className="uj-root">
        <Banner appearance="danger">
          Could not determine the current issue. Reopen the panel from an issue.
        </Banner>
      </div>
    );
  }

  if (loading && !plan) {
    return <PlanSkeleton />;
  }

  if (error) {
    return (
      <div className="uj-root">
        <ErrorState message={error} onRetry={() => fetchPlan(issueKey)} />
      </div>
    );
  }

  if (!plan) return null;

  if (!plan.isBlocked) {
    return (
      <div className="uj-root">
        <EmptyState
          glyph="✓"
          title="Nothing blocking this issue"
          description="You're clear — no open issue is blocking this one, so there's nobody to chase."
        />
      </div>
    );
  }

  const nearestBlocker = plan.openBlockers?.[0] ?? plan.chain?.[0];
  if (!nearestBlocker) {
    // Defensive: isBlocked implies at least one open blocker.
    return (
      <div className="uj-root">
        <EmptyState
          glyph="✓"
          title="Nothing blocking this issue"
          description="You're clear — no open issue is blocking this one, so there's nobody to chase."
        />
      </div>
    );
  }

  const summaryParts = [];
  const blockerAge = ageText(nearestBlocker.created);
  if (blockerAge) summaryParts.push(`blocked for ${blockerAge}`);
  if (typeof nearestBlocker.waitingCount === 'number') {
    summaryParts.push(
      `${nearestBlocker.waitingCount} ${plural(nearestBlocker.waitingCount, 'issue')} waiting`,
    );
  }
  const tracking = plan.tracking;

  // Stagger entrances after the candidate cards, capped so long lists
  // don't push the later sections too far out.
  const chainDelay = Math.min(120 + plan.unblockers.length * 60, 420);
  const draftDelay = chainDelay + 60;
  const trackingDelay = draftDelay + 60;
  const notesDelay = trackingDelay + 60;

  return (
    <div className="uj-root">
      <div className="uj-stack uj-stack--loose">
        {success && (
          <div className="uj-fade-up" style={{ '--uj-delay': '0ms' }}>
            <Banner appearance="success" title="Request sent">
              {success}
            </Banner>
          </div>
        )}
        {sendError && (
          <div className="uj-fade-up" style={{ '--uj-delay': '0ms' }}>
            <Banner appearance="danger">{sendError}</Banner>
          </div>
        )}

        <Hero plan={plan} nearestBlocker={nearestBlocker} summaryParts={summaryParts} delay={0} />

        <div className="uj-stack uj-stack--tight">
          <div className="uj-fade-up" style={{ '--uj-delay': '60ms' }}>
            <SectionTitle>Who can unblock this</SectionTitle>
          </div>
          {plan.unblockers.length === 0 ? (
            <p className="uj-small uj-muted uj-fade-up" style={{ '--uj-delay': '120ms', margin: 0 }}>
              No unblocker candidate was found — the blocker may be unassigned with no recent
              contributors or similar resolved work.
            </p>
          ) : (
            plan.unblockers.map((candidate, index) => (
              <CandidateCard
                key={candidate.accountId}
                candidate={candidate}
                delay={120 + index * 60}
                sendingAccountId={sendingAccountId}
                onSend={sendRequest}
              />
            ))
          )}
        </div>

        <div className="uj-stack uj-stack--tight uj-fade-up" style={{ '--uj-delay': `${chainDelay}ms` }}>
          <SectionTitle>Blocker chain</SectionTitle>
          <div className="uj-card">
            <div className="uj-stack uj-stack--tight">
              {plan.chain.map((node) => {
                const nodeAge = ageText(node.created);
                const details = [];
                if (nodeAge) details.push(nodeAge);
                details.push(node.assignee ? node.assignee.displayName : 'Unassigned');
                if (node.depth > 1) details.push(`${node.depth} hops away`);
                return (
                  <div key={node.key} className="uj-row uj-row--wrap">
                    <button type="button" className="uj-link" onClick={() => openIssue(node.key)}>
                      {node.key}
                    </button>
                    <StatusLozenge status={node.status} statusCategory={node.statusCategory} />
                    <span className="uj-small uj-muted">{details.join(' · ')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {plan.draft && plan.unblockers.length > 0 && (
          <div
            className="uj-stack uj-stack--tight uj-fade-up"
            style={{ '--uj-delay': `${draftDelay}ms` }}
          >
            <SectionTitle>Draft request</SectionTitle>
            <div className="uj-card uj-card--sunken">
              <p className="uj-draft-text">{plan.draft.text}</p>
            </div>
            <div>
              <LoadingButton
                appearance="primary"
                isLoading={sendingAccountId === plan.unblockers[0].accountId}
                disabled={sendingAccountId !== null}
                onClick={() => sendRequest(plan.unblockers[0])}
              >
                Post request
              </LoadingButton>
            </div>
          </div>
        )}

        {tracking && (
          <div className="uj-fade-up" style={{ '--uj-delay': `${trackingDelay}ms` }}>
            <Banner
              appearance={tracking.escalatedAt ? 'warning' : 'info'}
              title={tracking.escalatedAt ? 'Request escalated' : 'Request in progress'}
            >
              {`Request sent to ${tracking.unblockerName} ${relativeTime(tracking.requestedAt)} · SLA ${tracking.slaHours}h · `}
              {tracking.escalatedAt
                ? 'escalated — a follow-up has been posted.'
                : "we'll follow up if there's no reply."}
            </Banner>
          </div>
        )}

        {plan.notes && plan.notes.length > 0 && (
          <div
            className="uj-stack uj-stack--tight uj-fade-up"
            style={{ '--uj-delay': `${notesDelay}ms` }}
          >
            <div className="uj-small uj-strong uj-muted">Notes</div>
            {plan.notes.map((note, index) => (
              <div key={`note-${index}`} className="uj-small uj-muted">
                {note}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
