// Unjam issue panel (UI Kit 2).
//
// Leads with PEOPLE, not the graph: ranked unblockers first, then the
// compact blocker chain, then the draft, then the tracking banner.
// No Tabs — sections keep the panel scannable in the narrow issue view.
// All data comes from the resolver; nothing here is hardcoded.
// NOTE: Forge's build uses the classic JSX transform (React.createElement),
// so the default React import is REQUIRED — without it the bundle
// references an undefined free `React` and the panel never renders
// (skeleton forever, no error in forge logs). Found 14 Nov 2026.
import React from 'react';
import ForgeReconcilerModule, {
  Badge,
  Box,
  Button,
  EmptyState,
  ErrorMessage,
  Heading,
  Inline,
  LoadingButton,
  Lozenge,
  ProgressBar,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  User,
  useProductContext,
  xcss,
} from '@forge/react';
import { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';

// @forge/react is a CommonJS module whose reconciler is its `default`
// export. Unwrap defensively: Forge's webpack bundler unwraps
// `exports.default` for `__esModule` modules, but other toolchains resolve
// a default import to the whole `module.exports` object (see the note in
// src/resolver.js). This works under both.
const ForgeReconciler = ForgeReconcilerModule?.default ?? ForgeReconcilerModule;

const cardStyle = xcss({
  backgroundColor: 'color.background.neutral',
  borderRadius: 'border.radius.200',
  padding: 'space.150',
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

function ageDays(isoDate) {
  if (!isoDate) return null;
  const ms = Date.now() - Date.parse(isoDate);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / MS_PER_DAY);
}

function ageText(isoDate) {
  const days = ageDays(isoDate);
  if (days === null) return null;
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

// "2h ago" / "3d ago" for the tracking banner.
function relativeTime(isoDate) {
  if (!isoDate) return '';
  const ms = Date.now() - Date.parse(isoDate);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const hours = Math.floor(ms / MS_PER_HOUR);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(ms / MS_PER_DAY);
  return `${days}d ago`;
}

function costBadgeAppearance(label) {
  switch (label) {
    case 'Critical':
      return 'danger';
    case 'High':
      return 'warning';
    case 'Medium':
      return 'primary';
    default:
      return 'default';
  }
}

function statusLozengeAppearance(statusCategory) {
  switch (statusCategory) {
    case 'done':
      return 'success';
    case 'indeterminate':
      return 'inprogress';
    default:
      return 'default';
  }
}

function scoreBadgeAppearance(total) {
  if (total >= 75) return 'success';
  if (total >= 50) return 'primary';
  if (total >= 25) return 'warning';
  return 'default';
}

function App() {
  const context = useProductContext();
  const issueKey = context?.extension?.issue?.key;
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sendingAccountId, setSendingAccountId] = useState(null);
  const [success, setSuccess] = useState(null);
  const [sendError, setSendError] = useState(null);

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
        setSuccess(
          `Request sent to ${unblocker.displayName} on ${blocker.key}. ` +
            "We'll follow up if there's no reply within 48 hours.",
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
  if (!context) {
    return (
      <Box padding="space.200">
        <Stack space="space.150" alignInline="center">
          <Spinner size="medium" label="Loading issue context" />
          <Text>Loading…</Text>
        </Stack>
      </Box>
    );
  }

  if (!issueKey) {
    return (
      <Box padding="space.200">
        <ErrorMessage>
          Could not determine the current issue. Reopen the panel from an issue.
        </ErrorMessage>
      </Box>
    );
  }

  if (loading && !plan) {
    return (
      <Box padding="space.200">
        <Stack space="space.150" alignInline="center">
          <Spinner size="medium" label="Finding who can unblock this issue" />
          <Text>Finding who can unblock this…</Text>
        </Stack>
      </Box>
    );
  }

  if (error) {
    return (
      <Box padding="space.200">
        <Stack space="space.150">
          <ErrorMessage>{error}</ErrorMessage>
          <Button appearance="primary" onClick={() => fetchPlan(issueKey)}>
            Try again
          </Button>
        </Stack>
      </Box>
    );
  }

  if (!plan) return null;

  if (!plan.isBlocked) {
    return (
      <Box padding="space.200">
        <EmptyState
          header="Nothing blocking this issue"
          description="You're clear — no open issue is blocking this one, so there's nobody to chase."
        />
      </Box>
    );
  }

  const nearestBlocker = plan.openBlockers[0];
  const summaryParts = [];
  const blockerAge = ageText(nearestBlocker.created);
  if (blockerAge) summaryParts.push(`blocked for ${blockerAge}`);
  if (typeof nearestBlocker.waitingCount === 'number') {
    summaryParts.push(
      nearestBlocker.waitingCount === 1
        ? '1 issue waiting'
        : `${nearestBlocker.waitingCount} issues waiting`,
    );
  }
  const tracking = plan.tracking;

  return (
    <Box padding="space.200">
      <Stack space="space.200">
        {success && (
          <SectionMessage appearance="success" title="Request sent">
            <Text>{success}</Text>
          </SectionMessage>
        )}
        {sendError && <ErrorMessage>{sendError}</ErrorMessage>}

        <Stack space="space.100">
          <Heading size="medium">Blocked by {nearestBlocker.key}</Heading>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            {plan.cost && (
              <Badge appearance={costBadgeAppearance(plan.cost.label)}>
                {`${plan.cost.label} cost · ${plan.cost.total}/100`}
              </Badge>
            )}
            {summaryParts.length > 0 && (
              <Text size="small" color="color.text.subtle">
                {summaryParts.join(' · ')}
              </Text>
            )}
          </Inline>
          <Text size="small" color="color.text.subtle">
            {nearestBlocker.summary}
          </Text>
        </Stack>

        <Stack space="space.150">
          <Heading size="small">Who can unblock this</Heading>
          {plan.unblockers.length === 0 ? (
            <Text size="small" color="color.text.subtle">
              No unblocker candidate was found — the blocker may be unassigned with no
              recent contributors or similar resolved work.
            </Text>
          ) : (
            plan.unblockers.map((candidate) => (
              <Box key={candidate.accountId} xcss={cardStyle}>
                <Stack space="space.100">
                  <Inline space="space.100" alignBlock="center" spread>
                    <Inline space="space.100" alignBlock="center">
                      <User accountId={candidate.accountId} />
                      <Badge appearance={scoreBadgeAppearance(candidate.total)}>
                        {`${candidate.total}`}
                      </Badge>
                    </Inline>
                    <LoadingButton
                      appearance="primary"
                      spacing="compact"
                      isLoading={sendingAccountId === candidate.accountId}
                      isDisabled={sendingAccountId !== null}
                      onClick={() => sendRequest(candidate)}
                    >
                      Send request
                    </LoadingButton>
                  </Inline>
                  <ProgressBar
                    value={candidate.total / 100}
                    ariaLabel={`Match score ${candidate.total} out of 100 for ${candidate.displayName}`}
                    appearance={candidate.total >= 70 ? 'success' : 'default'}
                  />
                  {candidate.reasons.map((reason, index) => (
                    <Text
                      key={`${candidate.accountId}-reason-${index}`}
                      size="small"
                      color="color.text.subtle"
                    >
                      {reason}
                    </Text>
                  ))}
                </Stack>
              </Box>
            ))
          )}
        </Stack>

        <Stack space="space.100">
          <Heading size="small">Blocker chain</Heading>
          {plan.chain.map((node) => {
            const nodeAge = ageText(node.created);
            const details = [];
            if (nodeAge) details.push(nodeAge);
            details.push(node.assignee ? node.assignee.displayName : 'Unassigned');
            if (node.depth > 1) details.push(`${node.depth} hops away`);
            return (
              <Inline key={node.key} space="space.100" alignBlock="center" shouldWrap>
                <Text weight="semibold">{node.key}</Text>
                <Lozenge appearance={statusLozengeAppearance(node.statusCategory)}>
                  {node.status}
                </Lozenge>
                <Text size="small" color="color.text.subtle">
                  {details.join(' · ')}
                </Text>
              </Inline>
            );
          })}
        </Stack>

        {plan.draft && plan.unblockers.length > 0 && (
          <Stack space="space.100">
            <Heading size="small">Draft request</Heading>
            <Box xcss={cardStyle}>
              <Text>{plan.draft.text}</Text>
            </Box>
            <Inline space="space.100">
              <LoadingButton
                appearance="primary"
                isLoading={sendingAccountId === plan.unblockers[0].accountId}
                isDisabled={sendingAccountId !== null}
                onClick={() => sendRequest(plan.unblockers[0])}
              >
                Post request
              </LoadingButton>
            </Inline>
          </Stack>
        )}

        {tracking && (
          <SectionMessage appearance="information" title="Request in progress">
            <Text>
              {`Request sent to ${tracking.unblockerName} ${relativeTime(tracking.requestedAt)} · SLA ${tracking.slaHours}h · `}
              {tracking.escalatedAt
                ? 'escalated — a follow-up has been posted.'
                : "we'll follow up if there's no reply."}
            </Text>
          </SectionMessage>
        )}

        {plan.notes && plan.notes.length > 0 && (
          <Stack space="space.050">
            <Text size="small" weight="semibold" color="color.text.subtle">
              Notes
            </Text>
            {plan.notes.map((note, index) => (
              <Text key={`note-${index}`} size="small" color="color.text.subtle">
                {note}
              </Text>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

ForgeReconciler.render(<App />);
