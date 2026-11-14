# Judge Setup — Unjam

Welcome, and thank you for evaluating Unjam. This guide takes about **15
minutes** end to end: install the app, create the demo data, and try every
feature. No code, no terminal, no Atlassian login beyond your own site admin
account.

## What you need

- A Jira Cloud site where you are a **site admin** (required to install apps).
  A free 90-day Codegeist dev site works — it includes Rovo Enterprise.
- The **installation link** from the Devpost submission.
- About 5 minutes to create the demo data (or skip it and use any project that
  already has an issue linked with "is blocked by").

## 1. Install Unjam (2 minutes)

1. Open the installation link from the submission.
2. You will be asked to choose a site. Pick your Jira site and confirm.
3. Review the permissions. Unjam requests 9 scopes:

   | Scope | Why |
   | --- | --- |
   | `read:jira-work` | Read issues, links, and statuses. |
   | `read:jira-user` | Resolve people by name. |
   | `write:jira-work` | Post unblock requests, follow-ups, and "cleared" comments. |
   | `storage:app` | Track sent requests and their SLA state. |
   | `read:graph:issue:jira` | Teamwork Graph: assigned work (workload). |
   | `read:graph:issue-status:jira` | Teamwork Graph: work-item status. |
   | `read:graph:issue-comment:jira` | Teamwork Graph: who commented (familiarity). |
   | `read:graph:user:atlassian` | Teamwork Graph: user identity. |
   | `read:graph:team:atlassian` | Teamwork Graph: team membership (team fit). |

   The five `read:graph:*` scopes touch the Teamwork Graph and need **org admin
   approval**. If you are the org admin, approve them during install; if not,
   ask your org admin to approve the app — the app still installs, but the
   people signals (workload, familiarity, team fit) will report as unreadable
   until approval lands.
4. Wait about **one minute** after install for the scopes to propagate before
   trying the features.

Unjam declares **no license key** and **no external egress**: all data stays
inside your Atlassian site.

## 2. Create the demo data (5 minutes)

The demo scenario is the fictional **ORB (Orbit Mobile)** project. Full
details are in [DEMO_DATA.md](DEMO_DATA.md); here is the quick version.

### 2a. Create the project

Create a team-managed (or company-managed) project with key **ORB** and name
**Orbit Mobile**.

### 2b. Create five issues

| Key | Summary | Type | Priority | Assignee | Due (relative to today) |
| --- | --- | --- | --- | --- | --- |
| ORB-45 | Release 4.2 to the App Store | Task | High | (you, or any user) | +5 days |
| ORB-42 | Checkout crashes on iOS 19 when applying promo codes | Bug | Highest | (you, or any user) | +3 days |
| ORB-31 | Payments API returns rate-limit errors under load | Bug | High | (a second user, if available) | +4 days |
| ORB-38 | Add Apple Pay as a checkout option | Story | Medium | (any user) | +10 days |
| ORB-27 | Legal approval for new payment terms | Task | Medium | **Leave unassigned** | −2 days (overdue) |

Move ORB-42 and ORB-31 to **In Progress**. Leave the rest in To Do.

> Tip: with a single-user site, assign ORB-42 to yourself and ORB-31 to
> yourself as well — the ranking still works (you will be the top unblocker).
> With two or more users, assign ORB-31 to someone else to see the cross-person
> ranking. The unassigned ORB-27 is the interesting case either way.

### 2c. Add four "is blocked by" links

On each waiting issue, click **Add link** (or the link icon), choose
**is blocked by**, and pick the blocker:

| Waiting issue | is blocked by |
| --- | --- |
| ORB-45 | ORB-42 |
| ORB-42 | ORB-31 |
| ORB-38 | ORB-31 |
| ORB-38 | ORB-27 |

That is the whole scenario: a release blocked by a crash, blocked by a payments
bug — plus a second story blocked by the same payments bug and an unowned legal
approval.

## 3. Try the issue panel (3 minutes)

1. Open **ORB-42** and click **Unjam** above the Activity section.
2. **Expected:** the panel traces the chain (ORB-42 ← ORB-31), names the
   assignee of ORB-31 as the top unblocker with a score and reasons ("Owns the
   blocking issue ORB-31", plus workload/expertise reasons if data is
   available), and shows a draft request.
3. Click **Send request**.
   **Expected:** a success message, a tracking banner ("Request sent … · SLA
   48h"), and a real comment posted on **ORB-31** mentioning the unblocker.
   Open ORB-31 to verify the comment.
4. Open **ORB-31** and click **Unjam**.
   **Expected:** the not-blocked empty state — "Nothing blocking this issue —
   you're clear." (ORB-31 *is* a blocker; it is not *blocked*.)

## 4. Try the project page (2 minutes)

1. Open the **ORB** project and click the **Unjam — Blocked Work** tab.
2. **Expected:** three rows ranked by block cost:
   - **ORB-42** (blocked by ORB-31) — the most expensive row, High cost.
   - **ORB-45** (blocked by ORB-42 → ORB-31) — High cost.
   - **ORB-38** (blocked by ORB-31 and ORB-27) — Medium cost.
   
   The header summarizes the count (3 blocked). ORB-31 is the blocker behind
   the two most expensive rows.

## 5. Try the Rovo agent (3 minutes)

Rovo requires a paid plan or a dev site. On a free-tier site this section is
unavailable — the panel, project page, and daily watch still work.

1. Open **Rovo chat** (top navigation), choose **Browse agents**, and pick
   **Unjam**.
2. Ask: **"Who can unblock ORB-42?"**
   **Expected:** the ORB-31 assignee, with score and reasons.
3. Ask: **"What is the most expensive blocker in this project?"**
   **Expected:** ORB-31, with its cost drivers (age, waiting count).
4. Ask: **"Draft an unblock request for ORB-42."**
   **Expected:** the agent shows the full draft and asks for confirmation. It
   does **not** send it on its own.
5. Reply **"Yes, send it."**
   **Expected:** the agent confirms the comment was posted on ORB-31 and that
   tracking has started.

## 6. Try the MCP tools (optional, 2 minutes)

1. In Atlassian Administration, go to **Apps → Sites → your site → Connected
   apps**, open Unjam, and enable the tools for external MCP exposure
   (disabled by default; this is per installation).
2. The endpoint is `https://mcp.atlassian.com/forge/<appId>`, where `<appId>` is
   the UUID portion of `app.id` in the submission's manifest.
3. Add it as a remote MCP server in Claude, Cursor, or VS Code and authorize
   with OAuth. The five tools (`get-blockers`, `find-unblockers`,
   `get-block-cost`, `draft-unblock-request`, `send-unblock-request`) appear
   and behave exactly as they do in Rovo chat.

## 7. Try the admin settings (1 minute)

1. In Jira, go to **Settings → Apps → Manage apps**, open **Unjam**, and click
   **Configure** (or Jira Settings → Apps → Unjam settings).
2. **Expected:** a settings page with three controls — the follow-up SLA
   (default 48 hours), an automatic follow-up on/off switch, and the cost
   threshold that counts a blocker as "critical" on the board (default 75).
3. Change the SLA to 24 hours and save. **Expected:** a "Settings saved"
   confirmation. New requests now track against a 24-hour SLA; requests
   already in flight keep the SLA they were sent with. (You can change it
   back to 48 hours afterwards.)

## 8. The daily watch (no action needed)

Once a day, Unjam checks every tracked request. If a blocker is still open
when a request's SLA expires (48 hours by default — see section 7), a
follow-up comment is posted on the blocking issue and the row is flagged as
escalated on the project page. If the blocker is resolved, tracking is
cleared and the waiting issue gets a "cleared" comment. The watch starts
about 5 minutes after install and runs at a consistent time per
installation — the exact hour cannot be chosen, so same-day verification is
usually not possible; the tracking banner on the issue panel shows the
request is being watched.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| The Unjam button does not appear on an issue | You need permission to edit the issue to see the panel button. Check that you are logged in as a user with edit permission on that issue, and that the app is installed on this site. |
| The panel shows "could not be read" notes for workload / teams / comments | The Teamwork Graph scopes are not approved yet, or are still propagating (about 1 minute after install/approval). Scores fall back gracefully: availability becomes a neutral estimate and team fit scores zero. Approve the `read:graph:*` scopes as org admin, wait a minute, and reload. |
| The project page is empty | No open issue in the project has an open blocker. Double-check the four links in step 2c — the link type must be **is blocked by** on the waiting issue, not "blocks". |
| The Rovo agent is not listed | Rovo requires a paid plan or a dev site. On a free-tier site the agent, skill, and MCP tools are unavailable. Also confirm the app is installed on the site you are chatting from. |
| The agent says it cannot find an issue | Ask with an exact key ("Who can unblock ORB-42?") or open the issue in Jira first so the agent has context. The agent never guesses keys. |
| A send fails | Check that you have permission to comment on the blocking issue. The panel and the agent both report the error instead of claiming success. |
| Scores look different from DEMO_DATA.md | Scores use live data: issue ages on a fresh site start at 0, so the age driver is lower than in the script's day-6/day-12 scenario. The ranking and the top unblocker are what to compare — they are stable. |

## Quick reference — what to click

| Feature | Where |
| --- | --- |
| Issue panel | Any issue → **Unjam** button above Activity |
| Project page | Project navigation → **Unjam — Blocked Work** tab |
| Admin settings | Manage apps → Unjam → **Configure** |
| Rovo agent | Rovo chat → **Browse agents** → **Unjam** |
| MCP endpoint | `https://mcp.atlassian.com/forge/<appId>` (enable in Connected apps first) |
| Daily watch | Automatic; tracking banner on the issue panel shows watched requests |
