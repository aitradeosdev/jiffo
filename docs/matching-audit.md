# Matching audit

The matching code as it stands, against each requirement in [the matching plan](matching.md) (M1 to M15). No code was changed for this audit. The security IDs it cites (MB3, G1, E6, L4, D4) are in [the security plan](security-plan.md).

**In short:** today every errand goes on one open board, urgent or not. Approved agents see the errands near them and the first to accept gets it. Accepting is safe: one transaction locks the errand and holds the money. Nothing is offered to an agent: no ranking, travel times, batching, offers or radius steps, and nothing is pushed to agents when an errand is posted.

## Status

| ID | Status | Files | What is missing |
|---|---|---|---|
| M1 Eligibility | Partly | `packages/shared/src/matching.ts`, `apps/api/src/matching/eligibility.service.ts`, `apps/api/src/errands/errands.service.ts` (`board`, accept in `effectOf`) | **Built:** one check for the board and for accepting, run again inside the accept transaction. It covers being online with a recent, real position, a pickup within reach, categories and purchases, and the agent's own errands. It keeps apart a customer and an agent flagged together. An agent who left an errand, or was replaced on it, never gets it back. An open fake-GPS flag holds an agent for up to a day. Errands at once: an urgent errand is held alone, board errands up to a cap. The agent's own work radius, within what admin allows, and "Don't match me again", either side's choice on an errand they shared. **Missing:** declined or expired offers (with offers, M6). |
| M2 Live locations | Partly | `apps/mobile/src/agent/presence.tsx`, `apps/mobile/src/agent/background-rules.ts`, `apps/mobile/src/agent/background-location.ts`, `apps/api/src/agents/presence.service.ts`, `apps/api/src/db/schema.ts` (`agent_presence`) | The app already reports every 10 s while moving and every 60 s while still. The server keeps the latest position in Postgres only, with no Redis geo sets per state. |
| M3 Travel time | Missing | `apps/api/src/adapters/maps.ts` | Nothing works out travel times from several agents to a pickup: no Google Route Matrix, no Mapbox Matrix, no shortlist of the nearest agents and no 60-second cache. There is also no fallback at the state's average speed. Today only a single route (pickup to drop-off) is asked for, for the quote. |
| M4 Ranking | Missing | `apps/api/src/errands/errands.service.ts` (`board`) | There is no score. The board orders by straight-line distance only. Ratings are stored (`errand_ratings`) and averaged for the panel and profiles, and tiers exist, but none of it ranks agents. Acceptance rate, completion rate, waiting time, tier boosts and new-agent averages don't exist. |
| M5 Batching | Missing | `apps/api/src/timers/` (BullMQ already runs the errand timers) | There is no batch job per state and no Hungarian assignment. |
| M6 One-at-a-time offers | Missing | `apps/api/src/errands/errand-notifier.ts`, `apps/mobile/src/agent/request.tsx`, `apps/mobile/src/agent/board.tsx` | Nothing records offers. No offer is sent to one agent with a 20-second countdown, sound or vibration. Pushes go only to an errand's own customer and agent, never to agents when an errand is posted. The request screen shows the customer's first name but not the verified badge, rating or completed count. The customer sees how many agents are online nearby, not a growing radius. |
| M7 Accepting safely | Partly | `apps/api/src/errands/errands.service.ts` (`runTransition`, accept in `effectOf`), `apps/api/src/money/wallet.service.ts` (`onErrandTransition`), `apps/api/test/errands.e2e.test.ts` | **Done:** accepting is one transaction. It locks the errand row, checks its version and state, locks the agent's account against suspension, and holds the fee in escrow in the same transaction. A lock per agent, taken on every accept, keeps the rules on errands held at once (M1) from being raced. A test has two agents accept at once and exactly one gets it. **Missing:** a check that the offer is addressed to this agent and still open (there are no offers), the 50-agent race test, and telling the others at once that the errand was taken: the agent who loses gets "Errand not found". |
| M8 Radius steps and last resort | Missing | `packages/shared/src/settings.ts` (`timers`), `apps/api/src/errands/errands.service.ts` (`scheduleTimers`) | `urgentWidenMinutes` (5) and `raisePricePromptMinutes` (15) are saved and shown in the panel, but nothing uses them. Only `urgentExpiryMinutes` (30) works: an urgent errand nobody takes expires, with nothing to refund. There are no radius steps, no offer counts per step and no broadcast fallback. Raising the price doesn't restart a search. |
| M9 Acceptance rate | Missing | none | Nothing counts offers, so there is no acceptance rate, uncounted offers, orange border, agent-app figures or pause level. |
| M10 Back-to-back offers | Missing | `packages/shared/src/matching.ts` (`heldRefusal`) | An urgent errand is held alone, and errands from the board up to the Matching cap (default 3). There is no "near the final drop-off" rule and no single errand waiting behind the current one. |
| M11 Open board | Partly | `apps/api/src/errands/errands.service.ts` (`board`), `apps/mobile/src/agent/board.tsx`, `apps/api/src/realtime/realtime.gateway.ts` | **Done:** only the errands near the agent that they may take (M1), nearest first, then newest; the app can sort by fee or show purchase errands only; the first to accept wins, safely (M7); the board says how many errands the agent's preferences hide. **Missing:** the board also shows urgent errands. There is no "Best for you" order and no "newest" sort. Updates aren't live: the app reloads every 20 s, so a taken errand stays on screen until then. |
| M12 Scheduled errands | Partly | `apps/api/src/errands/errands.service.ts` (`create`) | **Done:** customers schedule at least 15 minutes ahead, and the errand waits on the board. **Missing:** the bar on completion rate, being online 15 minutes before the start, taking the errand back 10 minutes before and sending it as urgent, the reliability drop, and keeping agents off urgent errands that would make them late. |
| M13 After launch | Missing (by design) | none | Destination mode, carrying two urgent errands at once and acceptance prediction come after launch. |
| M14 Admin settings, Matching | Partly | `packages/shared/src/settings.ts`, `apps/admin/src/lib/settings-fields.ts`, `apps/api/src/admin/settings-admin.service.ts`, `apps/api/src/countries/prices.service.ts` | Settings are per country, versioned and approved by a second admin. A Matching group now holds who may get an errand: how recent a position must be (2 minutes), how far a pickup may be (10 km), errands from the board at once (3) and the fake-GPS hold (24 hours). The plan's other values come with their parts. Only prices can be set per state, city and area (`price_overrides`); matching needs the same. |
| M15 Dashboard and logs | Missing | `apps/api/src/db/schema.ts` (`errand_events`), `apps/api/src/admin/errands-admin.service.ts` | Every errand change is logged with its time, including who accepted. Time to accept could be worked out from that log, but there is no offer log (who was offered it, in what order, the score and its parts, the answer). There are no matching figures per state or per agent. |

## Tests the plan asks for

| Test | Status |
|---|---|
| Ranking: the expected agent gets the first offer, and a weight change reorders | Missing |
| Batching: the Hungarian assignment beats greedy nearest-first | Missing |
| Offers: a time-out moves on, a decliner is never offered it again, one offer per agent at a time | Missing |
| Race: 50 accepts at once give one assignment and one escrow hold | Partly: 2 agents at once today, checking only that one gets it, not that one escrow hold is made |
| Simulation: 200 agents and 500 errands in Lagos, in CI, failing on a large regression | Missing |

## The owner's decisions that change the plan

These were agreed with the owner after reading the plan, and the build follows them:

- **Errands at once** (in place of M1's "no active errand"). An agent on an urgent errand takes no other errand, apart from the plan's back-to-back offer (M10). Non-urgent errands from the board can be held several at a time, up to a cap admin sets (default 3).
- **Missed offers** (on top of M9). An agent who lets several offers in a row run out is taken offline, with the number of misses set by admin. Otherwise a low acceptance rate only lowers ranking, as M9 says.
- **Offers ring.** An offer comes as a high-priority notification on Android and a time-sensitive one on iPhone, so it sounds even when the app is closed.
- **Travel times come from the maps provider in use, Google or Mapbox** (in place of M3's "Google Routes at launch").
  - Through the maps adapter: Google's Route Matrix or Mapbox's Matrix, whichever provider is switched on.
  - When it fails, straight-line distance at the state's average speed.
- **Nearest agents from Redis.** Redis geo sets find the agents near a pickup. The database still makes the final check that an agent may take the errand, when they accept.
- **Batching** with the Hungarian assignment, per state, as the plan says (M5).
- **Matching settings per place.** Set per country, with state, city and area able to set their own, the same way prices work now.
- **The plan's gaps:**
  - The selfie is needed only where the country has the agent selfie check switched on (M1).
  - A new agent counts as the state's average for the 50% bar on scheduled errands.
  - The offer log is kept as long as other errand records.

## Points the plan leaves open, and how they're settled

- **A scheduled errand taken ahead isn't active until it starts** (M1 and M12). Until then the agent still gets offers and sees the board, except for urgent offers that would make them late for it (M12).
- **Two ways to accept** (M7, M8, M11). Both run in one transaction with the escrow hold.
  - An offer is accepted only while it is open, addressed to this agent and not expired, and the errand is still unassigned.
  - A board errand or a last-resort broadcast is accepted only while the errand is still waiting and unassigned, and the agent may take it now (M1).
- **A raised fee brings back the agents who said no** (M8 over M1 and M6): they turned down the lower fee. The offers test allows that.
- **Tier boosts come on top of the score** (M4). The weighted score runs from 0 to 1, and a boost is added after it, so a boosted score can go above 1. Admin sets each boost between 0 and 0.2.

## Order of work

As the plan sets it, one area per pull request, with tests first:

1. Eligibility (M1), live locations in Redis and travel times (M2, M3), ranking (M4), one-at-a-time offers (M6) and accepting an offer safely (M7).
2. Batching (M5), radius steps and the last resort (M8), acceptance rate (M9), board order and live updates (M11), and the Matching settings and dashboard (M14, M15).
3. Back-to-back offers (M10) and the scheduled-errand rules (M12).
4. After launch: M13.
