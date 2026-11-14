# Demo Script — Unjam (video, under 5 minutes)

**Total runtime: ~4 minutes 30 seconds.** Record at 1080p, Jira in light mode,
browser zoom 100%. Use the ORB demo data from
[DEMO_DATA.md](DEMO_DATA.md) — create it before recording. Speak the lines
below (or paraphrase them); the "Show" notes are what must be visible on
screen. Keep the cursor slow and deliberate.

---

## Scene 1 — The problem (0:00–0:30)

**Show:** Jira, ORB-2 open ("Checkout crashes on iOS 19 when applying promo
codes"). Scroll to the linked issues: "is blocked by ORB-3".

**Say:**

> "This is ORB-2 — our checkout crashes on iOS 19, and the release is waiting
> on it. Jira tells me it's blocked by ORB-3, a payments API bug in another
> team. What Jira doesn't tell me is who can actually unblock it, or what I
> should say to them. So blocked work just… sits there. Unjam answers both
> questions."

**Cut to:** the Unjam button above the Activity section.

---

## Scene 2 — The issue panel, live (0:30–2:00)

**Show:** Click **Unjam**. The panel loads (spinner, then content).

**Say:**

> "One click, and Unjam traces the blocker chain — ORB-2 is blocked by
> ORB-3, open since today, two issues waiting on it. And here is the answer:
> ask Andi Pangeran."

**Show:** The top unblocker card — Andi's avatar, score badge, reasons.
Point at each reason as you name it.

**Say:**

> "Andi owns ORB-3. He commented on the blocker today, and he only has
> four open items right now. The score isn't a guess — every point comes
> with its reason, and if a data source can't be read, Unjam says so
> instead of pretending."

**Show:** Scroll to the draft request.

**Say:**

> "Unjam already drafted the ask — a polite comment for Andi on ORB-3, with
> the context he needs. One click sends it."

**Show:** Click **Send request**. The success message appears; the tracking
banner appears ("Request sent to Andi · SLA 48h · we'll follow up if there's
no reply").

**Say:**

> "Posted — as a real comment on ORB-3, mentioning Andi. And Unjam is now
> tracking it. If ORB-3 is still open in 48 hours, a follow-up goes out
> automatically."

---

## Scene 3 — The project page (2:00–2:45)

**Show:** Switch to the project. Click the **Unjam — Blocked Work** tab.

**Say:**

> "Now the whole project. Every blocked issue in ORB, ranked by what the wait
> actually costs — age, how many issues are waiting, deadline, priority.
> ORB-2 is the most expensive row, and it's blocked by ORB-3 — the same
> blocker holding up the release and the Apple Pay story. Fix ORB-3 first and
> three issues move."

**Show:** Point at the ORB-4 row.

**Say:**

> "And here's ORB-4, also blocked by ORB-5 — a legal approval with no
> assignee at all. With only one person on this demo site, Unjam honestly
> shows no match here instead of inventing one — it never pretends to know
> what it can't see."

---

## Scene 4 — The Rovo agent (2:45–3:45)

**Show:** Open Rovo chat. Browse agents → **Unjam**. Type the first question.

**Say:**

> "Same engine, in plain language. I ask Unjam: who can unblock this issue?"

**Show:** The agent's answer — Andi, score, reasons.

**Say:**

> "Same answer, same reasons. Now the project question."

**Show:** Type: *"What is the most expensive blocker in this project?"*

**Say:**

> "ORB-3 again — the agent weighs the cost the same way the board does. And
> now the draft."

**Show:** Type: *"Draft an unblock request for me."* The agent shows the draft
and asks for confirmation.

**Say:**

> "Notice what it does not do: it doesn't send. It shows the draft and asks.
> Unjam never messages a real person without a human saying yes."

**Show:** Reply "Yes, send it." The agent confirms the comment was posted and
tracking started.

---

## Scene 5 — MCP + follow-up and escalation (3:45–4:15)

**Show:** A terminal or MCP client config with the endpoint
`https://mcp.atlassian.com/forge/<appId>` (blur or replace the real app ID if
you prefer), then a client calling the `find-unblockers` tool and getting
Andi back. Alternatively, show Rovo Studio with the Unjam tools listed.

**Say:**

> "The same five tools are exposed over MCP — so a custom agent in Rovo
> Studio, or an external client like Claude or Cursor, can ask Unjam the same
> questions."

**Show:** Back in Jira, the tracking banner on ORB-2 (or the project page
flag on an escalated row, if one is available).

**Say:**

> "And the loop closes itself: the daily watch escalates past-SLA requests and
> clears tracking the moment the blocker is resolved. The work moves, or
> someone gets reminded — nothing stalls silently."

---

## Scene 6 — Why it matters (4:15–4:30)

**Show:** Title card: **Unjam — Blocked work, meet the person who can
unblock it.** (Keep the ORB board faintly visible behind it, or cut to the
project page.)

**Say:**

> "Unjam doesn't draw another dependency graph. It finds the person, writes
> the ask, and follows up until the work moves. Runs entirely on Atlassian —
> no external services, no extra cost."

**End card:** App name, "Built with Forge for Codegeist 2026", installation
link note (in the video description).

---

## Recording checklist

- [ ] ORB demo data live on the dev site (ORB-1..ORB-5, 4 links) — see
      [DEMO_DATA.md](DEMO_DATA.md) for the mapping to the doc's original keys.
- [ ] Andi has commented on ORB-3 (the test send), so the familiarity signal
      shows a live reason ("Commented on this blocker today"). Note: no
      expertise signal on this demo site — the script doesn't claim one.
- [ ] Rovo agent installed and visible under Browse agents.
- [ ] Send a request from ORB-2 during Scene 2 — do it live, not pre-recorded.
      Use the PRODUCTION panel (the dev panel already sent one). Optionally
      delete the earlier test comment on ORB-3 first for a clean recording.
- [ ] Total runtime under 5:00 (target 4:30; trim pauses in Scene 4 if needed).
- [ ] No real user data, no production site — dev site only.
- [ ] Upload as a public YouTube video; put the installation link and the
      setup doc link in the description.
