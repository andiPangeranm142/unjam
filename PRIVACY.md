# Privacy Policy — Unjam (Unblock Assistant for Jira)

Last updated: 14 November 2026

Unjam is a Forge app by Andi Pangeran, built for the Codegeist 2026
hackathon. It helps Jira users find who can unblock their work.

## What Unjam accesses

When you open the Unjam panel, project page, or Rovo agent, the app reads
from your own Jira site, through Atlassian's APIs, only what it needs to
rank unblockers:

- Issue data: keys, summaries, statuses, priorities, due dates, assignees,
  and issue links (blocker relationships).
- Workload and team signals via the Atlassian Teamwork Graph: assigned
  work items, team memberships, and comment authors on the waiting issue
  and its open blockers (last 90 days).
- User display names and account IDs for the people it recommends.

## What Unjam stores

Unjam stores unblock-request tracking records in Atlassian Forge storage
on your own site: the waiting issue key, the blocker issue key, the
unblocker's Atlassian account ID, and sent/followed-up timestamps. This
powers the "Request in progress" banner and the 48-hour follow-up.
No names, email addresses, or issue content are stored outside Atlassian.

## What Unjam sends elsewhere

Nothing. Unjam makes no network calls to any third-party service. All data
stays within Atlassian's platform (Jira, Teamwork Graph, Forge storage).
Unjam does not sell data, does not show ads, and does not use tracking
cookies.

## Comments posted by Unjam

When you click "Send request", Unjam posts a comment on the blocker issue
as you, mentioning the recommended unblocker. The comment text is shown
to you in the panel before you send it. Unjam never posts anything
without you clicking send.

## Deleting your data

Uninstalling the app removes its Forge storage data from your site.
Comments already posted stay in Jira as ordinary issue comments; delete
them from the issue if you want them gone.

## Contact

Questions about this policy: andijiphone@gmail.com.
