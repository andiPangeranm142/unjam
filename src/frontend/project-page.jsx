// Unjam project page (UI Kit 2).
//
// All blocked work in the project, costliest first, in a DynamicTable.
// All data comes from the resolver; nothing here is hardcoded.
import ForgeReconcilerModule, {
  Box,
  Button,
  DynamicTable,
  EmptyState,
  ErrorMessage,
  Heading,
  Link,
  Lozenge,
  Spinner,
  Stack,
  Text,
  User,
  useProductContext,
} from '@forge/react';
import { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';

// @forge/react is a CommonJS module whose reconciler is its `default`
// export. Unwrap defensively: Forge's webpack bundler unwraps
// `exports.default` for `__esModule` modules, but other toolchains resolve
// a default import to the whole `module.exports` object (see the note in
// src/resolver.js). This works under both.
const ForgeReconciler = ForgeReconcilerModule?.default ?? ForgeReconcilerModule;

// Lozenge appearances (Atlaskit): default | inprogress | moved | new |
// removed | success. 'danger'/'warning' are Badge values, NOT Lozenge ones.
function costLozengeAppearance(label) {
  switch (label) {
    case 'Critical':
      return 'removed';
    case 'High':
      return 'moved';
    case 'Medium':
      return 'inprogress';
    default:
      return 'default';
  }
}

function ageText(ageDays) {
  if (typeof ageDays !== 'number' || ageDays < 0) return '—';
  if (ageDays === 0) return 'Today';
  if (ageDays === 1) return '1 day';
  return `${ageDays} days`;
}

function App() {
  const context = useProductContext();
  const projectKey = context?.extension?.project?.key;
  const siteUrl = context?.siteUrl;
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchBlocks = async (key) => {
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
  };

  useEffect(() => {
    if (projectKey) fetchBlocks(projectKey);
  }, [projectKey]);

  const issueUrl = (key) => (siteUrl ? `${siteUrl}/browse/${key}` : `/browse/${key}`);

  if (!context) {
    return (
      <Box padding="space.200">
        <Stack space="space.150" alignInline="center">
          <Spinner size="medium" label="Loading project context" />
          <Text>Loading…</Text>
        </Stack>
      </Box>
    );
  }

  if (!projectKey) {
    return (
      <Box padding="space.200">
        <ErrorMessage>
          Could not determine the current project. Reopen this page from a project.
        </ErrorMessage>
      </Box>
    );
  }

  if (loading && !result) {
    return (
      <Box padding="space.200">
        <Stack space="space.150" alignInline="center">
          <Spinner size="medium" label="Loading blocked work" />
          <Text>Loading blocked work…</Text>
        </Stack>
      </Box>
    );
  }

  if (error) {
    return (
      <Box padding="space.200">
        <Stack space="space.150">
          <ErrorMessage>{error}</ErrorMessage>
          <Button appearance="primary" onClick={() => fetchBlocks(projectKey)}>
            Try again
          </Button>
        </Stack>
      </Box>
    );
  }

  if (!result) return null;

  const criticalCount = result.blocks.filter(
    (block) => block.cost && block.cost.label === 'Critical',
  ).length;
  const summaryParts = [
    `${result.blockedCount} blocked`,
    `${criticalCount} critical`,
    `${result.totalOpen} open issues`,
  ];

  return (
    <Box padding="space.200">
      <Stack space="space.200">
        <Stack space="space.100">
          <Heading size="large">Blocked work</Heading>
          <Text size="small" color="color.text.subtle">
            {summaryParts.join(' · ')} — costliest blockers first.
          </Text>
        </Stack>

        {result.blocks.length === 0 ? (
          <EmptyState
            header="No blocked work"
            description="Nothing in this project is waiting on another issue right now. To try Unjam, create two issues and link one to the other with “is blocked by”, then come back here."
          />
        ) : (
          <DynamicTable
            caption={`Blocked work in ${result.projectKey}`}
            head={{
              cells: [
                { key: 'waiting', content: 'Waiting issue' },
                { key: 'blocker', content: 'Blocked by' },
                { key: 'age', content: 'Age' },
                { key: 'waitingCount', content: 'Waiting' },
                { key: 'cost', content: 'Cost' },
                { key: 'unblocker', content: 'Top unblocker' },
              ],
            }}
            rows={result.blocks.map((block) => ({
              // One row per (issue, blocker) pair: an issue with two open
              // blockers appears twice, so the issue key alone is not unique.
              key: `${block.issue.key}::${block.blocker.key}`,
              cells: [
                {
                  key: 'waiting',
                  content: (
                    <Stack space="space.050">
                      <Link href={issueUrl(block.issue.key)}>{block.issue.key}</Link>
                      <Text size="small" color="color.text.subtle">
                        {block.issue.summary}
                      </Text>
                    </Stack>
                  ),
                },
                {
                  key: 'blocker',
                  content: (
                    <Stack space="space.050">
                      <Link href={issueUrl(block.blocker.key)}>{block.blocker.key}</Link>
                      <Text size="small" color="color.text.subtle">
                        {block.blocker.summary}
                      </Text>
                    </Stack>
                  ),
                },
                { key: 'age', content: ageText(block.ageDays) },
                {
                  key: 'waitingCount',
                  content:
                    typeof block.waitingCount === 'number'
                      ? `${block.waitingCount}`
                      : '—',
                },
                {
                  key: 'cost',
                  content: block.cost ? (
                    <Lozenge appearance={costLozengeAppearance(block.cost.label)}>
                      {`${block.cost.label} · ${block.cost.total}`}
                    </Lozenge>
                  ) : (
                    '—'
                  ),
                },
                {
                  key: 'unblocker',
                  content: block.topUnblocker ? (
                    <User accountId={block.topUnblocker.accountId} />
                  ) : (
                    '—'
                  ),
                },
              ],
            }))}
            rowsPerPage={10}
            isLoading={loading}
          />
        )}

        {result.notes && result.notes.length > 0 && (
          <Stack space="space.050">
            <Text size="small" weight="semibold" color="color.text.subtle">
              Notes
            </Text>
            {result.notes.map((note, index) => (
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
