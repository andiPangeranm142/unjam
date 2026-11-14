// Unblocker candidate gathering for Unjam (CONCEPT.md section 5.3).
// Collects raw signals (0-100 per signal, before weights) from three
// sources, deduplicated by accountId:
//   - assignee + reporter of each open blocker (ownership)
//   - commenters on the blockers and the waiting issue, last 90 days (familiarity)
//   - assignees of similar resolved issues (expertise)
// Workload (availability) and team membership are then looked up in
// parallel per candidate via the Teamwork Graph. Scoring happens in
// plan.js — this module only gathers raw signals, in discovery order
// (blocker owners first), capped at maxCandidates.

import { daysBetween } from './scoring.js';
import { isOpenStatus, workItemAri } from './twg.js';

// Comment history is checked for the waiting issue plus the first few open
// blockers, to bound Teamwork Graph calls on long chains.
const MAX_COMMENTER_ISSUES = 6;

function ownershipFor(role, depth) {
  if (role === 'assignee') return depth <= 1 ? 100 : 57;
  return depth <= 1 ? 63 : 34; // reporter
}

function ownershipReason(role, depth, blockerKey) {
  if (role === 'assignee') {
    return depth <= 1 ? `Owns the blocking issue ${blockerKey}` : `Owns ${blockerKey}, which blocks the blocker`;
  }
  return depth <= 1
    ? `Reported the blocking issue ${blockerKey}`
    : `Reported ${blockerKey}, which blocks the blocker`;
}

function availabilityFor(openCount) {
  if (openCount <= 2) return 100;
  if (openCount <= 5) return 70;
  if (openCount <= 9) return 40;
  return 15;
}

function recencyWeight(days) {
  if (days <= 30) return 1.0;
  if (days <= 90) return 0.6;
  return 0.3;
}

function plural(n, singular, pluralForm = `${singular}s`) {
  return n === 1 ? singular : pluralForm;
}

export async function buildCandidates(
  { jira, twg },
  { issue, chain, cloudId },
  { maxCandidates = 6, now = new Date() } = {},
) {
  const notes = [];
  const addNote = (note) => {
    if (!notes.includes(note)) notes.push(note);
  };
  const people = new Map();

  const ensurePerson = (person) => {
    if (!person?.accountId) return null;
    let entry = people.get(person.accountId);
    if (!entry) {
      entry = {
        accountId: person.accountId,
        displayName: person.displayName ?? 'Unknown',
        avatarUrl: person.avatarUrl,
        ownership: { value: 0, source: '' },
        ownershipReason: '',
        isBlockerAssignee: false,
        commentCount: 0,
        commentLastAt: null,
        commentKeys: [],
        resolved: [],
        workload: null, // { openCount } | 'unreadable' | null (not looked up)
        teamIds: new Set(),
        teamsUnreadable: false,
      };
      people.set(person.accountId, entry);
    }
    if (person.displayName && entry.displayName === 'Unknown') entry.displayName = person.displayName;
    if (person.avatarUrl && !entry.avatarUrl) entry.avatarUrl = person.avatarUrl;
    return entry;
  };

  const openBlockers = (chain ?? []).filter((n) => n.statusCategory !== 'done');

  // 1. Ownership: assignee + reporter of each open blocker.
  for (const blocker of openBlockers) {
    const depth = blocker.depth ?? 1;
    for (const [person, role] of [
      [blocker.assignee, 'assignee'],
      [blocker.reporter, 'reporter'],
    ]) {
      const entry = ensurePerson(person);
      if (!entry) continue;
      const value = ownershipFor(role, depth);
      if (value > entry.ownership.value) {
        entry.ownership = {
          value,
          source: `${role === 'assignee' ? 'Assignee' : 'Reporter'} of ${blocker.key} (depth ${depth})`,
        };
        entry.ownershipReason = ownershipReason(role, depth, blocker.key);
      }
      if (role === 'assignee') entry.isBlockerAssignee = true;
    }
  }

  // 2. Familiarity: commenters on the waiting issue + open blockers (90 days).
  if (twg) {
    const commentTargets = [issue, ...openBlockers];
    const checked = commentTargets.slice(0, MAX_COMMENTER_ISSUES);
    if (commentTargets.length > MAX_COMMENTER_ISSUES) {
      addNote(
        `Comment history checked for ${MAX_COMMENTER_ISSUES} of ${commentTargets.length} issues (lookup limit)`,
      );
    }
    if (!cloudId) {
      addNote('comment history could not be read: site id unavailable');
    } else {
      const results = await Promise.all(
        checked.map(async (target) => {
          if (!target?.id) {
            return {
              target,
              result: {
                items: [],
                notes: [
                  `comment history could not be read for ${target?.key ?? 'unknown issue'}: missing numeric id`,
                ],
              },
            };
          }
          const result = await twg.getCommenters(workItemAri(cloudId, target.id), { sinceDays: 90 });
          return { target, result };
        }),
      );
      for (const { target, result } of results) {
        for (const note of result.notes ?? []) addNote(note);
        for (const commenter of result.items ?? []) {
          const entry = ensurePerson({
            accountId: commenter.accountId,
            displayName: commenter.displayName,
          });
          if (!entry) continue;
          entry.commentCount += commenter.count ?? 0;
          if (commenter.lastAt && (!entry.commentLastAt || commenter.lastAt > entry.commentLastAt)) {
            entry.commentLastAt = commenter.lastAt;
          }
          if (target?.key && !entry.commentKeys.includes(target.key)) entry.commentKeys.push(target.key);
        }
      }
    }
  } else {
    addNote('Teamwork Graph is unavailable; comment history, workload and team signals were skipped.');
  }

  // 3. Expertise: assignees of similar resolved issues.
  try {
    const resolved = await jira.getResolvedSimilar(issue, { maxResults: 25 });
    for (const similar of resolved ?? []) {
      const entry = ensurePerson(similar.assignee);
      if (!entry) continue;
      entry.resolved.push(similar.resolved ?? similar.updated ?? null);
    }
  } catch (err) {
    addNote(`Similar resolved issues could not be read: ${err?.message ?? 'unknown error'}`);
  }

  // 4. Team context of the waiting issue (fetched once) + per-candidate
  // workload and teams (in parallel).
  const waitingReporterTeamIds = new Set();
  const waitingAssigneeTeamIds = new Set();
  if (twg) {
    const waitingLookups = [];
    if (issue?.reporter?.accountId) {
      waitingLookups.push(
        twg
          .getUserTeams(issue.reporter.accountId)
          .then((result) => ({ role: 'reporter', result }))
          .catch((err) => ({
            role: 'reporter',
            result: {
              items: [],
              notes: [`Teams for ${issue.reporter.accountId} could not be read: ${err?.message ?? 'unknown error'}`],
            },
          })),
      );
    }
    if (issue?.assignee?.accountId) {
      waitingLookups.push(
        twg
          .getUserTeams(issue.assignee.accountId)
          .then((result) => ({ role: 'assignee', result }))
          .catch((err) => ({
            role: 'assignee',
            result: {
              items: [],
              notes: [`Teams for ${issue.assignee.accountId} could not be read: ${err?.message ?? 'unknown error'}`],
            },
          })),
      );
    }
    for (const { role, result } of await Promise.all(waitingLookups)) {
      for (const note of result.notes ?? []) addNote(note);
      const target = role === 'reporter' ? waitingReporterTeamIds : waitingAssigneeTeamIds;
      for (const team of result.items ?? []) target.add(team.id);
    }

    await Promise.all(
      [...people.values()].map(async (entry) => {
        const [work, teams] = await Promise.all([
          twg.getAssignedWork(entry.accountId, { maxPages: 1 }).catch((err) => ({
            items: [],
            notes: [`Assigned work for ${entry.accountId} could not be read: ${err?.message ?? 'unknown error'}`],
          })),
          twg.getUserTeams(entry.accountId).catch((err) => ({
            items: [],
            notes: [`Teams for ${entry.accountId} could not be read: ${err?.message ?? 'unknown error'}`],
          })),
        ]);
        for (const note of work.notes ?? []) addNote(note);
        for (const note of teams.notes ?? []) addNote(note);
        if ((work.notes ?? []).some((n) => n.includes('could not be read'))) {
          entry.workload = 'unreadable';
        } else {
          entry.workload = {
            openCount: (work.items ?? []).filter((item) => isOpenStatus(item.status)).length,
          };
        }
        if ((teams.notes ?? []).some((n) => n.includes('could not be read'))) {
          entry.teamsUnreadable = true;
        }
        for (const team of teams.items ?? []) entry.teamIds.add(team.id);
      }),
    );
  }

  // Team ids of blocker assignees OTHER than the candidate themselves: a
  // blocker assignee trivially "shares a team" with themselves, which must
  // not count as team proximity.
  const blockerAssigneeTeams = new Map(); // teamId -> Set(accountId)
  for (const entry of people.values()) {
    if (!entry.isBlockerAssignee) continue;
    for (const teamId of entry.teamIds) {
      if (!blockerAssigneeTeams.has(teamId)) blockerAssigneeTeams.set(teamId, new Set());
      blockerAssigneeTeams.get(teamId).add(entry.accountId);
    }
  }

  const candidates = [];
  for (const entry of people.values()) {
    let weightedCount = 0;
    for (const resolvedAt of entry.resolved) {
      const days = resolvedAt ? daysBetween(resolvedAt, now) : Number.POSITIVE_INFINITY;
      weightedCount += recencyWeight(days);
    }
    const expertiseValue = Math.min(100, Math.round(weightedCount * 16));
    const familiarityValue = entry.commentCount >= 3 ? 100 : entry.commentCount >= 1 ? 60 : 0;

    let availability;
    if (entry.workload === 'unreadable' || entry.workload === null) {
      // Neutral value for an unreadable workload signal (CONCEPT.md section 3).
      availability = { value: 50, source: 'Workload could not be read' };
    } else {
      availability = {
        value: availabilityFor(entry.workload.openCount),
        source: `${entry.workload.openCount} open ${plural(entry.workload.openCount, 'item')} assigned`,
      };
    }

    // A candidate trivially "shares a team" with themselves, which must not
    // count as team proximity — the reporter/assignee of the waiting issue
    // and the blocker assignees are excluded from their own match.
    const waitingReporterId = issue?.reporter?.accountId ?? null;
    const waitingAssigneeId = issue?.assignee?.accountId ?? null;
    const sharesWithReporter =
      entry.accountId !== waitingReporterId &&
      [...entry.teamIds].some((id) => waitingReporterTeamIds.has(id));
    const sharesWithWaitingAssignee =
      entry.accountId !== waitingAssigneeId &&
      [...entry.teamIds].some((id) => waitingAssigneeTeamIds.has(id));
    const sharesWithBlockerAssignee = [...entry.teamIds].some((id) => {
      const assignees = blockerAssigneeTeams.get(id);
      return assignees && [...assignees].some((id2) => id2 !== entry.accountId);
    });
    let team;
    if (sharesWithReporter) {
      team = { value: 100, source: 'Same team as the reporter of the waiting issue' };
    } else if (sharesWithWaitingAssignee) {
      team = { value: 100, source: 'Same team as the assignee of the waiting issue' };
    } else if (sharesWithBlockerAssignee) {
      team = { value: 60, source: 'Same team as the assignee of the blocking issue' };
    } else {
      team = {
        value: 0,
        source: entry.teamsUnreadable ? 'Team info could not be read' : 'No shared team found',
      };
    }

    const reasons = [];
    if (entry.ownership.value > 0 && entry.ownershipReason) reasons.push(entry.ownershipReason);
    if (expertiseValue > 0) {
      reasons.push(`Resolved ${entry.resolved.length} similar ${plural(entry.resolved.length, 'issue')}`);
    }
    if (
      availability.value >= 70 &&
      entry.workload &&
      entry.workload !== 'unreadable'
    ) {
      reasons.push(
        entry.workload.openCount === 0
          ? 'No open items right now'
          : `Only ${entry.workload.openCount} open ${plural(entry.workload.openCount, 'item')} right now`,
      );
    }
    if (familiarityValue > 0) {
      if (entry.commentLastAt) {
        const days = daysBetween(entry.commentLastAt, now);
        reasons.push(
          days <= 0
            ? 'Commented on this blocker today'
            : days === 1
              ? 'Commented on this blocker yesterday'
              : `Commented on this blocker ${days} days ago`,
        );
      } else {
        reasons.push(
          `Commented ${entry.commentCount} ${plural(entry.commentCount, 'time')} on this blocker recently`,
        );
      }
    }
    if (team.value === 100) {
      reasons.push(sharesWithReporter ? 'Same team as the reporter' : 'Same team as the assignee of the waiting issue');
    } else if (team.value === 60) {
      reasons.push('Same team as the blocker assignee');
    }

    candidates.push({
      accountId: entry.accountId,
      displayName: entry.displayName,
      ...(entry.avatarUrl ? { avatarUrl: entry.avatarUrl } : {}),
      signals: {
        ownership:
          entry.ownership.value > 0
            ? entry.ownership
            : { value: 0, source: 'Does not own or report a blocking issue' },
        expertise: {
          value: expertiseValue,
          source:
            entry.resolved.length > 0
              ? `Resolved ${entry.resolved.length} similar ${plural(entry.resolved.length, 'issue')}`
              : 'No similar resolved issues found',
        },
        availability,
        familiarity: {
          value: familiarityValue,
          source:
            entry.commentCount > 0
              ? `Commented ${entry.commentCount} ${plural(entry.commentCount, 'time')} on ${entry.commentKeys.join(', ') || 'related issues'} in the last 90 days`
              : 'No recent comments on related issues',
        },
        team,
      },
      reasons,
    });
  }

  const total = candidates.length;
  const capped = candidates.slice(0, maxCandidates);
  if (total > maxCandidates) {
    addNote(`Showing ${capped.length} of ${total} candidates (limit ${maxCandidates})`);
  }
  return { candidates: capped, notes };
}
