# Unjam — Unblock Assistant for Jira

> **Blocked work, meet the person who can unblock it.**

Unjam is a Forge app for Jira that answers the two questions Jira itself cannot
answer about a blocked issue: **who can unblock this**, and **what should I say
to them?** It traces blocker chains across projects and teams, ranks the people
who can open the blocker with a deterministic, explainable score, drafts the
request, sends it with one click — and follows up automatically if nothing moves
within 48 hours.

Built for **Codegeist 2026** (Apps for Software Teams), targeting the **Teamwork
Graph**, **Rovo Agents**, and **Atlassian MCP** bonuses.

---

## The problem

A blocked Jira issue does not fail loudly — it just stops. Jira shows *what* is
blocking it, but not *who* can open it or *how* to ask them. The person waiting
has to hunt down the owner of the blocking issue in another team, guess who is
free, and chase follow-ups by hand. Existing tools only visualize dependencies
or diagnose why work stalled. None of them route the request to the right
person and follow through until the work moves again.

## What Unjam does

For every blocked issue, Unjam:

1. **Traces the blocker chain** — multi-hop, across projects and teams, via
   `is blocked by` links, with cycle detection and safe limits.
2. **Finds who can unblock it** — the blocking issue's owner, its recent
   contributors, and experts on similar work — ranked by a deterministic,
   explainable score built from Teamwork Graph + Jira REST signals.
3. **Prices the wait** — a block-cost score (age × waiting issues × deadline ×
   priority) so teams fix the most expensive blocker first.
4. **Drafts the ask** — a polite @mention comment, ready to send.
5. **Tracks it until it moves** — one click posts the request and starts
   tracking; if the blocker is still open after the 48-hour SLA, Unjam posts a
   follow-up automatically; when the blocker clears, the waiting issue is
   notified.

## Features

| Surface | What you get |
| --- | --- |
| **Jira issue panel** (UI Kit 2) | "Blocked by ORB-31 — ask Priya, here's why": ranked unblockers with avatars, score badges, and reasons; the blocker chain; the draft; a **Send request** button; live tracking status. Clear empty state when the issue is not blocked. |
| **Jira project page** (UI Kit 2) | All blocked work in the project, ranked by block cost: waiting issue, blocked by, age, waiting count, cost badge, and top unblocker. |
| **Rovo agent "Unjam"** | Ask in plain language: "Who can unblock this issue?", "What is the most expensive blocker in this project?", "Draft an unblock request for me." The agent always shows the draft and asks for confirmation before sending anything. |
| **Rovo skill `unblock-playbook`** | A step-by-step playbook that orchestrates the five actions — trace → rank → weigh → draft → confirm → send → track — including SLA rules and edge cases. |
| **MCP tools (`rovo:mcp`)** | The same five actions exposed as MCP tools for custom agents in Rovo Studio and external MCP clients (Claude, Cursor, VS Code). |
| **Daily watch** (scheduled trigger) | Once a day, checks every tracked request: escalates past-SLA requests with a follow-up comment, and clears tracking (with a "cleared" comment) when the blocker resolves. |

## How it works

```
                        ┌─────────────────────────────┐
                        │  Jira issue panel (UI Kit)  │
                        │  Jira project page (UI Kit) │
                        └──────────────┬──────────────┘
                                       │ invoke()
                        ┌──────────────▼──────────────┐
                        │   resolver.js (UI Kit)      │
                        └──────────────┬──────────────┘
                                       │
   Rovo chat ──► Rovo agent "Unjam" ──►│  index.js (5 action handlers)
   Rovo Studio / MCP clients ──► rovo:mcp ──►│
   Daily schedule ──► scheduled.js ──►│
                                       ▼
                        ┌─────────────────────────────┐
                        │   plan.js — the unblock     │
                        │   engine (one engine, every │
                        │   surface)                  │
                        └──────┬──────────────┬───────┘
                    ┌──────────▼───┐  ┌───────▼────────┐
                    │ chain.js     │  │ candidates.js  │
                    │ traceBlockers│  │ buildCandidates│
                    └──────┬───────┘  └───────┬────────┘
                           │                  │
                    ┌──────▼───────┐  ┌───────▼────────┐
                    │ scoring.js   │  │ draft.js       │
                    │ (pure,       │  │ (pure, ADF     │
                    │ deterministic)│ │ comment drafts)│
                    └──────────────┘  └────────────────┘
                           │                  │
                    ┌──────▼──────────────────▼───────┐
                    │  jira.js (Jira REST)            │
                    │  twg.js  (Teamwork Graph API)   │
                    │  tracking.js (Forge storage)    │
                    └─────────────────────────────────┘
```

One engine, four surfaces: the issue panel, the project page, the Rovo agent,
and the MCP tools all run the same `buildUnblockPlan` / `buildProjectBlocks`
logic. The Rovo skill is the playbook that tells the agent how to sequence the
actions; the daily watch is the only piece that runs without a user present
(as the app, so it uses Jira REST only — Teamwork Graph is user-scoped).

### Forge modules used

| Module | Key | Why |
| --- | --- | --- |
| `jira:issuePanel` | `unjam-issue-panel` | The unblock answer where the blocked work lives — on the issue itself. |
| `jira:projectPage` | `unjam-project-page` | The project-wide view: every blocked issue ranked by what the wait costs. |
| `rovo:agent` | `unjam-agent` | Plain-language access to the same engine ("Who can unblock this?"). |
| `action` × 5 | `get-blockers`, `find-unblockers`, `get-block-cost`, `draft-unblock-request`, `send-unblock-request` | The executable capabilities the agent, the skill, and MCP all share. Four read-only (`GET`), one write (`CREATE`, confirmation-gated). |
| `rovo:skill` | `unblock-playbook` | The multi-step playbook: trace → rank → weigh → draft → confirm → send → track, plus SLA and edge-case rules. |
| `rovo:mcp` | `unjam-mcp` | Exposes the five actions as MCP tools for Rovo Studio agents and external AI clients. |
| `scheduledTrigger` | `unjam-daily-watch` | Daily SLA watch: escalate past-SLA requests, clear resolved ones. |
| `function` × 7 | `resolver`, the five action functions, `watch` | Backing functions for the UI resolver, the Rovo actions, and the daily watch. |

## The scoring model

Both scores are **deterministic and explainable** — no LLM guessing. Every
recommendation carries human-readable reasons, and every answer carries `notes`
for sources that could not be read (a declined scope, a rate limit, missing
data). Partial answers are reported as partial, never presented as complete.

### Unblocker score (0–100)

| Signal | Weight | How it is scored (raw 0–100, then weighted) |
| --- | --- | --- |
| **Ownership** | 35 | Assignee of the nearest (depth-1) blocker = 100; its reporter = 63; assignee of a deeper blocker = 57; its reporter = 34; commenter/expert only = 0. |
| **Expertise** | 25 | Resolved similar issues (same components/labels): ≤30 days old count 1.0, 31–90 days 0.6, older 0.3. Value = min(100, weighted count × 16). |
| **Availability** | 20 | Open items right now: 0–2 = 100; 3–5 = 70; 6–9 = 40; 10+ = 15; unreadable = 50 (neutral) + note. |
| **Familiarity** | 10 | Comments on the blocker or waiting issue in the last 90 days: 3+ = 100; 1–2 = 60; 0 = 0. |
| **Team fit** | 10 | Same team as the waiting issue's reporter/assignee = 100; same team as the blocker's assignee = 60; none/unreadable = 0 + note. |

`total = Σ (signal value / 100 × weight)`, rounded to the nearest whole number.

Example reasons a user actually sees: *"Owns the blocking issue ORB-31"*,
*"Resolved 6 similar issues in the last 90 days"*, *"Only 2 open items right
now"*, *"Commented on this blocker 3 days ago"*, *"Same team as the reporter"*.

### Block-cost score (0–100)

| Driver | Max points | How it is scored |
| --- | --- | --- |
| **Age** | 40 | 0–2 days = 5; 3–7 = 15; 8–14 = 25; 15–30 = 33; 30+ = 40. |
| **Waiting** | 30 | 0 waiting = 0; 1 = 8; 2–3 = 16; 4–6 = 23; 7+ = 30. Unknown count = 8 + note. |
| **Deadline** | 20 | Overdue = 20; due within 7 days = 14; within 30 days = 7; otherwise/no due date = 0. |
| **Priority** | 10 | Highest = 10; High = 7; Medium = 4; Low/Lowest = 1; none = 3. |

Labels: **Low** (<25), **Medium** (25–49), **High** (50–74), **Critical** (75+).

## Setup / installation (for judges)

> These steps need an Atlassian login and are run by the submitter. Judges
> install from the installation link in the Devpost submission — see
> [docs/JUDGE_SETUP.md](docs/JUDGE_SETUP.md) for the judge-facing walkthrough.

1. **Get a dev site.** A free 90-day Codegeist dev site (via
   `forge site provision`) includes Jira, Confluence, JSM, and Rovo Enterprise.
   Rovo requires a paid plan or a dev site — it is not available on the free
   tier.
2. **Register the app.** `forge register` fills in `app.id` in `manifest.yml`
   (the manifest ships with a placeholder). Then `forge deploy -e production`.
3. **Create the installation link.** Developer console → Distribution →
   Sharing (not "Sharing within organization") → select Jira → copy the link.
   The app declares **no license key** in its manifest, which is what makes
   installation-link sharing possible.
4. **Install.** A site admin opens the installation link and installs Unjam on
   their site. Unjam requests 9 scopes (see below); scopes that touch the
   Teamwork Graph need **org admin approval**, and scope changes take about a
   minute to propagate.
5. **Create the demo data** (~5 minutes): five ORB issues and four
   `is blocked by` links — step by step in
   [docs/JUDGE_SETUP.md](docs/JUDGE_SETUP.md), with the full scenario in
   [docs/DEMO_DATA.md](docs/DEMO_DATA.md).

### Scopes requested

| Scope | Why |
| --- | --- |
| `read:jira-work` | Read issues, links, and statuses. |
| `read:jira-user` | Resolve people by name. |
| `write:jira-work` | Post unblock requests, follow-ups, and "cleared" comments. |
| `storage:app` | Track sent requests and their SLA state. |
| `read:graph:issue:jira` | Teamwork Graph: assigned work items (workload). |
| `read:graph:issue-status:jira` | Teamwork Graph: work-item status for the workload filter. |
| `read:graph:issue-comment:jira` | Teamwork Graph: who commented on a blocker (familiarity). |
| `read:graph:user:atlassian` | Teamwork Graph: user identity in graph queries. |
| `read:graph:team:atlassian` | Teamwork Graph: team membership (team fit). |

No egress: Unjam never calls an external service. All data stays inside the
Atlassian site.

## How to use

### Issue panel

Open any Jira issue and click **Unjam** above the Activity section. If the
issue is blocked you see the top unblocker first (avatar, score, reasons), the
blocker chain, and the draft request. **Send request** posts the comment on the
blocking issue and starts tracking. If the issue is not blocked, the panel says
so plainly.

### Project page

Open the project and click the **Unjam — Blocked Work** tab. Every blocked
issue in the project, ranked by block cost, with its blocker, age, waiting
count, cost badge, and top unblocker.

### Rovo agent

Open Rovo chat, choose **Browse agents**, and pick **Unjam**. Try:

- *"Who can unblock this issue?"* (with an issue open)
- *"What is the most expensive blocker in this project?"*
- *"Draft an unblock request for me."*
- *"What is blocking ORB-42?"*

The agent shows the draft and asks for confirmation before sending anything.

### MCP endpoint

Each installation exposes the five tools at:

```
https://mcp.atlassian.com/forge/<appId>
```

where `<appId>` is the UUID portion of `app.id` in `manifest.yml`. External
exposure is disabled by default: a site or org admin enables it per
installation in Atlassian Administration → Apps → Sites → Connected apps.
Once enabled, add the URL as a remote MCP server in Claude, Cursor, or VS Code
and authorize with OAuth.

## Demo data

The demo scenario is the fictional **ORB (Orbit Mobile)** project: a mobile
app release held up by a chain of blockers — a crashing checkout, a
rate-limited payments API, and an unassigned legal approval. Full details
(issues, people, links, and what Unjam should conclude for each) are in
[docs/DEMO_DATA.md](docs/DEMO_DATA.md); the video script is in
[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Bonus mapping

| Bonus | How Unjam qualifies |
| --- | --- |
| **Teamwork Graph** | Consumes the Teamwork Graph API (`requestTeamworkGraph`) for the people signals behind every recommendation: assigned work (workload), commenters (familiarity), and team membership (team fit). The graph is the reason the ranking knows about *people*, not just issues. |
| **Rovo Agents** | A full Rovo agent (`rovo:agent`) with a file-based prompt, three conversation starters, five actions, and a `rovo:skill` playbook that orchestrates them — not a single-action demo. |
| **Atlassian MCP** | A `rovo:mcp` module exposing the same five actions as MCP tools, usable from Rovo Studio agents and external MCP clients at `https://mcp.atlassian.com/forge/<appId>`. |

## Limitations and verification items

Honest notes, because judges should know what is verified and what is not:

- **JQL `linkedIssues` direction semantics.** The waiting-count query uses
  `issue in linkedIssues("KEY", "is blocked by")`, read from the perspective of
  the issue that *is blocked by* KEY. This assumption must be verified on the
  dev site. The main chain traversal does **not** depend on it (it uses
  `issuelinks` from the issue REST API), so a wrong direction only affects the
  waiting count, not the chain or the ranking.
- **`forge lint` was not run in this sandbox.** It requires a logged-in Forge
  CLI. The local validator (`npm run validate`) replicates its main checks
  instead; the real `forge lint` is run by the submitter after login.
- **SLA is fixed at 48 hours in v1.** There is no admin page to change it yet;
  configurable SLA is future work.
- **Scheduled trigger timing is per-installation.** The daily watch starts
  about 5 minutes after deploy and then runs at a consistent time per
  installation; the exact hour cannot be chosen.
- **Rovo needs a paid plan or dev site.** On a free-tier site the Rovo agent,
  skill, and MCP tools are unavailable; the issue panel, project page, and
  daily watch still work.
- **Teamwork Graph is Preview.** Curated queries only, 25 rows per page, and a
  missing scope silently drops rows — Unjam reports unreadable sources in
  `notes` rather than pretending the data is complete.

## Project structure

```
unjam/
  manifest.yml                 Forge manifest: modules, resources, scopes
  package.json
  README.md
  src/
    index.js                   Rovo action handlers (thin)
    resolver.js                UI Kit resolver
    scheduled.js               Daily watch handler
    lib/
      forge-clients.js         Forge API adapters (asUser/asApp Jira + TWG)
      twg.js                   Teamwork Graph client + curated queries
      jira.js                  Jira REST client
      chain.js                 Blocker-chain traversal
      candidates.js            Unblocker candidate gathering
      scoring.js               Pure scoring (unblocker + block cost)
      draft.js                 Pure draft builders (ADF comments)
      tracking.js              Request tracking (storage injected)
      plan.js                  Orchestrator: buildUnblockPlan, buildProjectBlocks
    frontend/
      issue-panel.jsx          UI Kit 2 issue panel
      project-page.jsx         UI Kit 2 project page
  prompts/
    agent.md                   Rovo agent prompt
  skills/
    unblock-playbook/SKILL.md  Rovo skill playbook
  static/
    icon.svg                   App icon
  scripts/
    validate-manifest.mjs      Local manifest validator (forge lint stand-in)
  test/                        Jest tests (pure logic + fake clients)
  docs/
    DEMO_SCRIPT.md             Video demo script (< 5 minutes)
    JUDGE_SETUP.md             Judge installation + walkthrough
    DEMO_DATA.md               ORB demo scenario, fully specified
```

## Testing

```bash
npm test            # Jest: pure logic (scoring, chain, draft, candidates,
                    # tracking, plan) plus TWG client tests with fake clients
npm run validate    # Local manifest validator (see scripts/validate-manifest.mjs)
```

`forge lint`, `forge deploy`, and `forge install` require a logged-in Forge CLI
and are run by the submitter outside this sandbox.

## License note

No license key is declared in `manifest.yml` **by design**: apps with a license
cannot be shared via an installation link, and the installation link is how the
Codegeist judges install Unjam. The source in this repository is the
submitter's original work for Codegeist 2026.
