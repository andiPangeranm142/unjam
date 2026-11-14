# Demo Data — the ORB (Orbit Mobile) Scenario

This document fully specifies the fictional demo scenario used in the video demo
([DEMO_SCRIPT.md](DEMO_SCRIPT.md)) and the judge walkthrough
([JUDGE_SETUP.md](JUDGE_SETUP.md)). Anyone who creates this data on a Jira site
should see the same conclusions from Unjam.

## The story

**ORB** is a mobile app team whose release is stuck. The App Store release is
waiting on a checkout crash fix, the crash fix is waiting on a payments API
that rate-limits under load, and a new payment option is waiting on both the
payments API and a legal approval that nobody owns. One unowned blocker, one
overloaded platform engineer, one release at risk.

## The team (5 people)

| Person | Role | Team |
| --- | --- | --- |
| Maya Chen | Mobile lead | Orbit Mobile |
| Priya Nair | Platform engineer | Platform |
| Jonas Weber | Backend engineer | Orbit Mobile |
| Sofia Marino | QA engineer | Orbit Mobile |
| Daniel Okafor | Legal counsel | Legal |

On a dev site, these are the seeded demo users (or any five users renamed to
match). What matters is the assignment pattern below, not the exact accounts.

## The issues (5)

Create all five in project **ORB**. Set due dates **relative to the day you
create the data** (day 0 = today).

| Key | Summary | Type | Priority | Status | Assignee | Reporter | Due | Age* |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ORB-45 | Release 4.2 to the App Store | Task | High | To Do | Maya Chen | Sofia Marino | day +5 | 2 days |
| ORB-42 | Checkout crashes on iOS 19 when applying promo codes | Bug | Highest | In Progress | Maya Chen | Sofia Marino | day +3 | 4 days |
| ORB-31 | Payments API returns rate-limit errors under load | Bug | High | In Progress | Priya Nair | Maya Chen | day +4 | 6 days |
| ORB-38 | Add Apple Pay as a checkout option | Story | Medium | To Do | Jonas Weber | Maya Chen | day +10 | 3 days |
| ORB-27 | Legal approval for new payment terms | Task | Medium | To Do | **Unassigned** | Jonas Weber | day −2 (overdue) | 12 days |

\* Age = days since the issue was created. On a fresh dev site, issues are
created today, so the age signal starts at 0 and the cost scores below start
lower than the "day 6 / day 12" values quoted in the demo script. That is
expected: Unjam scores live data, and the **ranking and top unblockers are the
same** regardless of age. To reproduce the exact scores in the script, either
backdate the issues (not possible through the Jira UI) or simply read the
scores as shown — the story does not depend on the absolute numbers.

Components / labels (used by the expertise signal — set them if your project
has components enabled; labels alone are enough):

- ORB-42: component `Checkout`, label `ios`
- ORB-31: component `Payments API`, label `payments`
- ORB-38: component `Checkout`, label `payments`
- ORB-27: label `legal`
- ORB-45: label `release`

## The links (4 × "is blocked by")

On each waiting issue, add a link of type **is blocked by** pointing at the
blocker:

| Waiting issue | is blocked by |
| --- | --- |
| ORB-45 | ORB-42 |
| ORB-42 | ORB-31 |
| ORB-38 | ORB-31 |
| ORB-38 | ORB-27 |

## The blocker chain

```
ORB-45  Release 4.2 to the App Store        (Maya, High, due +5d)
  └─ blocked by ─► ORB-42  Checkout crashes on iOS 19   (Maya, Highest, due +3d)
                       └─ blocked by ─► ORB-31  Payments API rate-limit errors
                                                 (Priya, High, 6 days open)
ORB-38  Add Apple Pay as a checkout option  (Jonas, Medium, due +10d)
  ├─ blocked by ─► ORB-31  (same payments blocker)
  └─ blocked by ─► ORB-27  Legal approval for new payment terms
                             (UNASSIGNED, 12 days open, overdue)
```

**ORB-31 is the most expensive blocker in the project**: two issues wait on it
directly (ORB-42, ORB-38) and a third waits transitively (ORB-45, via ORB-42).

## What Unjam should conclude

Scores below are computed from the scoring model in the README, using the ages
and due dates in the table above. Live scores on a fresh site will differ in
the age driver only; the top unblocker and the relative ranking are stable.

### ORB-42 — the demo's hero issue

- **Blocked by:** ORB-31 (depth 1). No deeper chain.
- **Top unblocker: Priya Nair.** She owns ORB-31 (ownership 100/100), has
  resolved similar payments issues, and is the only person who can fix the
  rate limiting. Expected score roughly 75–90 depending on her live workload
  and comment history.
- **Cost: High (~55).** Age 6 days (15) + 2 waiting (16) + due in 3 days (14)
  + Highest priority (10) = 55.
- **Draft:** a request to Priya on ORB-31 mentioning the crash, the 6-day wait,
  and the 2 issues waiting.

### ORB-45 — the release

- **Blocked by:** ORB-42 (depth 1) → ORB-31 (depth 2). A two-hop chain.
- **Top unblocker: Maya Chen.** She owns the nearest open blocker, ORB-42
  (ownership 100/100 for a depth-1 assignee, vs 57 for Priya as a depth-2
  assignee). Priya should appear as the second-ranked candidate.
- **Cost: High (~52).** Most expensive blocker ORB-31: age 6 days (15) +
  2 waiting (16) + ORB-45 due in 5 days (14) + High priority (7) = 52.

### ORB-38 — two blockers, one unowned

- **Blocked by:** ORB-31 and ORB-27 (both depth 1).
- **Top unblocker: Priya Nair** (owns ORB-31). **Daniel Okafor** should appear
  as a candidate for ORB-27: it is unassigned, so Unjam falls back to experts
  on similar (legal) work — this is the "blocker without an owner" case.
- **Cost: Medium (~44).** Most expensive blocker ORB-27: age 12 days (25) +
  1 waiting (8) + ORB-38 due in 10 days (7) + Medium priority (4) = 44.

### ORB-31 and ORB-27 — the blockers themselves

- **Not blocked.** Opening either issue and clicking Unjam shows the
  not-blocked empty state: "Nothing blocking this issue — you're clear."
  (They *are* blockers; they are not *blocked*.)

### Project page (ORB) — expected ranking

| Rank | Waiting issue | Blocked by | Cost | Top unblocker |
| --- | --- | --- | --- | --- |
| 1 | ORB-42 | ORB-31 | High (~55) | Priya Nair |
| 2 | ORB-45 | ORB-42 → ORB-31 | High (~52) | Maya Chen |
| 3 | ORB-38 | ORB-31, ORB-27 | Medium (~44) | Priya Nair |

Header summary: **3 blocked · 2 high-cost** (0 critical at these ages).

### Rovo agent — expected answers

- *"Who can unblock ORB-42?"* → Priya Nair, with reasons (owns ORB-31,
  similar payments work, current workload).
- *"What is the most expensive blocker in ORB?"* → ORB-31, driving the two
  highest-cost rows (ORB-42 and ORB-45).
- *"Draft an unblock request for ORB-42."* → A draft to Priya on ORB-31,
  followed by a confirmation question. Nothing is sent until the user says yes.

## Reproducing the demo exactly

1. Create the project and issues as specified above (or use the seeded demo
   data if your dev site already has blocked issues — the conclusions will
   differ, but the features are the same).
2. Set the four links.
3. Optional, for a richer ranking: have Priya comment once on ORB-31 ("Looking
   into the rate limiter now") and resolve one older payments bug, so the
   familiarity and expertise signals have live data.
4. Open ORB-42, click **Unjam**, and compare against "ORB-42" above.
