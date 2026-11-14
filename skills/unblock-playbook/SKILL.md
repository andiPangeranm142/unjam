---
name: unblock-playbook
description: Unblock stuck Jira work end to end — trace the blocker chain, rank the people who can open it, weigh what the wait costs, draft the ask, confirm with the user, send it, and track it until the work moves. Use whenever a user asks who can unblock an issue, what is blocking it, how expensive a blocker is, or for help writing or sending an unblock request.
allowed-tools: get-blockers find-unblockers get-block-cost draft-unblock-request send-unblock-request
---

# Unblock Playbook

Use this playbook whenever a user wants to move blocked Jira work forward. It
orchestrates the five Unjam actions into one complete workflow: trace, rank,
weigh, draft, confirm, send, track. Work through the steps in order and skip
only the steps the user's request does not need.

## Before you start

- **Identify the issue.** If the user names an issue key, use it. If an issue is
  open in Jira, the actions default to it. If neither is true, ask which issue
  they mean — never guess a key.
- **Use only these five actions** for facts about Jira. Never invent people,
  keys, statuses, dates, or scores. Every claim in your answer must trace back
  to an action result.
- **Keep responses small.** Actions return at most 6 unblockers and 10 project
  blockers; present the top result first and at most two alternatives.

## Step 1 — Trace the blockers (`get-blockers`)

Call `get-blockers` with the issue key.

- The result is a chain: the waiting issue, then each blocker, outward. Each
  node carries its key, summary, status, assignee, depth, and how many issues
  are waiting on it.
- **If the chain is empty, the issue is not blocked.** Stop here and say so
  plainly: "This issue is not blocked by any open issue." Do not call the other
  actions for it — there is nothing to unblock, rank, or draft.
- **If the chain stops early**, the notes will say why (depth limit, cycle, or a
  blocker that could not be read). Report that honestly: "I traced 3 hops; the
  chain may continue past that."
- **If the action returns an error**, tell the user what failed in plain words
  and stop. Do not retry the same call more than once, and do not fall back to
  guessing.

## Step 2 — Find the unblockers (`find-unblockers`)

Call `find-unblockers` with the same issue key.

- Candidates are ranked by a deterministic score (0–100) built from five
  signals: **ownership** (35), **expertise** (25), **availability** (20),
  **familiarity** (10), and **team fit** (10). Each candidate carries human-readable
  reasons — quote them, do not paraphrase them into new claims.
- Present the top-ranked person first: name, score, and the two or three
  strongest reasons (for example, "Owns the blocking issue ORB-31" or "Resolved
  6 similar issues in the last 90 days"). Then, briefly, the next one or two
  alternatives.
- **Ownership beats everything else.** The assignee of the nearest open blocker
  is usually the right person to ask, even if an expert scores close behind.
  Say so when that is the case.
- **If there are no candidates**, say so and explain what you checked: the
  blocker has no assignee, no recent commenters, and no matching experts. Offer
  the next best step instead — usually drafting a request to the reporter's team
  or asking the user who owns the blocking work.
- **If the notes report unreadable sources** (workload, teams, or comment
  history could not be read), say which signal is affected and how: availability
  falls back to a neutral estimate, team fit scores zero. Never hide this.

## Step 3 — Weigh the cost (`get-block-cost`)

Call `get-block-cost` when the user asks about cost or priority, or when you
need to justify why this blocker deserves attention now.

- For one issue, pass the issue key. For a whole project, pass the project key
  and you will get the most expensive blockers ranked, up to 10.
- Cost (0–100) comes from four drivers: **age** of the block (up to 40),
  **waiting count** (up to 30), **deadline proximity** (up to 20), and
  **priority** (up to 10). Labels: Low (<25), Medium (25–49), High (50–74),
  Critical (75+).
- When you report a cost, always name the two biggest drivers — for example,
  "Critical (82): open 12 days with 3 issues waiting." A bare number without
  drivers is not an explanation.
- **If the waiting count is unknown**, the notes will say so and the score uses
  a conservative estimate. Mention that the true cost may be higher.

## Step 4 — Draft the request (`draft-unblock-request`)

Call `draft-unblock-request` when the user wants a message to send, or when you
are about to ask for confirmation to send one.

- Pass the issue key. Pass an `unblocker` name only if the user picked someone
  other than the top-ranked candidate; otherwise the draft addresses the
  top-ranked unblocker automatically.
- The draft is a polite comment that mentions the unblocker on the **blocking
  issue** (not the waiting issue) and gives them the context they need: what is
  blocked, how long it has waited, how many issues are waiting, and a specific
  ask (a status update or unblocking the issue).
- **Always show the full draft text to the user** before anything is sent, and
  name the blocker issue it will be posted on and the person it mentions.
- If the user wants changes — a different tone, extra context, a deadline —
  incorporate their words into the message when sending (see Step 6). You do
  not need to re-draft for small edits; just confirm the final wording with them.

## Step 5 — Confirm before sending

**Never call `send-unblock-request` without the user's explicit confirmation.**

- After showing the draft, ask a direct question: "Want me to send this to
  [name] on [blocker key]?"
- A vague reply ("sure, whatever", "maybe later") is not confirmation. If the
  user is unsure, offer to adjust the draft or hold off — do not send.
- If the user asks you to send a request but has not seen a draft yet, draft
  first, show it, and ask. No exceptions.

## Step 6 — Send and track (`send-unblock-request`)

Only after explicit confirmation, call `send-unblock-request` with the issue
key, the confirmed unblocker, and any extra message the user asked to include.

- The action posts the comment on the blocking issue as the user, mentions the
  unblocker, and starts tracking the request.
- Confirm the outcome to the user: which issue the comment was posted on, who
  was mentioned, and that Unjam will follow up automatically if the blocker is
  still open after 48 hours.
- **If the send fails**, report the error plainly and do not claim the request
  went out. Offer to retry once or to let the user copy the draft and post it
  manually.

## SLA and escalation

- Every sent request is tracked against a **48-hour SLA**. This is fixed in
  version 1 and cannot be changed per project.
- If the blocker is still open 48 hours after the request, Unjam automatically
  posts a polite follow-up comment on the blocking issue and marks the request
  as escalated on the project page. Only **one** escalation is posted per
  request.
- If the blocker is resolved (or the waiting issue is no longer blocked), the
  tracking is cleared and the waiting issue gets a "cleared" comment. You do
  not need to do anything — the daily watch handles it.
- If a user asks about the status of a request, point them to the issue panel
  or the project page, which show live tracking state. You have no action that
  reads tracking state directly, so say so rather than guessing.

## Edge cases

- **Issue not blocked:** stop after Step 1. Say so clearly. Do not invent
  unblockers or drafts.
- **Blocker without an owner:** the playbook still works — `find-unblockers`
  falls back to recent commenters and experts on similar work. Say explicitly
  that the blocker is unassigned, and name the expert you are recommending
  instead of an owner.
- **No candidates at all:** explain what was checked and offer the next best
  step (ask the user who owns the blocking work, or draft a request to the
  reporter's team lead).
- **Unreadable sources:** report them from the action's `notes` every time.
  Partial answers are fine; pretending they are complete is not.
- **Multiple blockers:** rank by cost (Step 3) and start with the most expensive
  open blocker. Mention the others briefly so the user knows the full picture.
- **User changes their mind:** if they pick a different unblocker, re-draft for
  that person (Step 4) and confirm again (Step 5) before sending.
- **Action errors:** report the failure in plain words, suggest what the user
  can do (check permissions, try again in a minute), and stop. Never present a
  failed action's absence as a result.
