# Jiffo matching plan

This document sets how errands reach agents. It follows the way Uber, Bolt and DoorDash dispatch work, adapted to Jiffo. It replaces the matching rules in the product spec where they differ. Every number is a default stored in admin settings per country (group: **Matching**), not a value written into the code.

The owner's decisions after reading this plan, and how the points it leaves open are settled, are in [the audit](matching-audit.md#the-owners-decisions-that-change-the-plan). Where they differ from this plan, they win.

## How to use this document

1. **Audit first.** Compare the existing matching code with each requirement below, by its ID (M1, M2 and so on). Write the result to `docs/matching-audit.md` as a table: ID, status (done, partly, missing), files involved, and what is missing. Change no code during the audit.
2. **Build in the order under "Order of work"**, one area per pull request, with tests.
3. Follow [the security plan](security-plan.md) on every change. Accepting an offer is a race and needs the same care as money code.

## The model in one paragraph

Urgent errands are **dispatched**: the server gathers requests for a few seconds, ranks the eligible agents for each one, mainly by real travel time to the pickup, and offers the errand to **one agent at a time**. Each agent has 20 seconds to accept before the offer moves to the next agent. If nobody takes it, the search radius widens step by step. As a last resort the errand goes to every eligible agent at once, and the first to accept gets it. Errands that aren't urgent stay on the **open board**, where agents choose for themselves, sorted best-first for each agent. Counter-offers after accepting work as before.

## Order of work

1. Eligibility (M1), live locations and ETA (M2, M3), ranking (M4), one-at-a-time offers (M6), atomic accept (M7).
2. Batching (M5), radius steps and fallback (M8), acceptance rate (M9), board sorting (M11), admin settings and dashboard (M14, M15).
3. Back-to-back offers (M10) and scheduled-errand rules (M12).
4. *After launch:* destination mode and multi-errand batching (M13).

## Eligibility (M1)

An agent can be offered an errand, or see it on the board, only if all of these are true:

- They are online and passed today's selfie check, and the app attestation for going online is current (security plan MB3).
- Their location was updated in the last 2 minutes and isn't flagged as fake GPS (security plan G1).
- The pickup is within their own work radius and within the current search radius (M8).
- The category is on in their errand preferences, and purchase errands only reach agents who take them.
- They have no active errand, unless the back-to-back rule allows it (M10), and no other offer waiting on their screen.
- They aren't suspended, banned or under review.
- They aren't the customer's own agent account, neither side chose "Don't match me again", and the pair has no collusion flag (security plan E6).
- They haven't already declined or let this errand's offer expire, or been replaced by "Get new agent" on it.

## Live locations and ETA (M2, M3)

- **M2 Live locations.** Online agents send their location every 10 seconds while moving and every 60 seconds while still. The server keeps the latest position in Redis geo sets per state (`GEOADD`, `GEOSEARCH`). PostGIS stays the store for trails and service areas.
- **M3 Travel time, not straight-line distance.** "Closest doesn't always mean quickest", as Uber puts it.
  - Take the 10 nearest eligible agents by straight line.
  - Get road travel time from each of them to the first pickup through the maps adapter (Google Routes at launch), with live traffic.
  - Cache results for 60 seconds per agent and pickup cell. If the maps call fails, fall back to straight-line distance at the state's average speed, and log it.

## Ranking (M4)

Each eligible agent gets a score from 0 to 1. The highest score gets the first offer.

| Factor | Weight | How it is measured |
|---|---|---|
| Pickup travel time | 60% | 1 minus (minutes ÷ 30), floored at 0 |
| Reliability | 20% | Average of acceptance rate (M9) and completion rate, minus 0.1 per cancellation after accepting in the last 7 days, floored at 0 |
| Rating | 10% | (Average rating over the last 100 errands minus 3) ÷ 2, kept between 0 and 1 |
| Waiting time | 10% | Minutes since their last errand ended or since going online ÷ 60, capped at 1 |

- Weights are admin settings and must add up to 100%. The **waiting time** factor spreads work to agents who have waited longest, as fair-dispatch systems do.
- **Tier boost:** admin can add a bonus per tier (default 0 for every tier).
- **New agents** use the state's average reliability and rating until they have 20 offers and 10 errands. They are never starved for lack of history, and they face no probation limits.
- Ties go to the shorter travel time.

## Batching (M5)

This follows Uber's batched matching. Uber says it waits "just a few seconds" after a request so that a batch of possible matches can build up.

- A BullMQ job per state runs every 3 seconds and collects the urgent requests waiting for a first offer.
- One request in the batch: offer it to its top-ranked agent.
- Several requests: assign agents so the **total** score across the batch is highest, using the Hungarian algorithm on the score matrix. This avoids giving the one agent who is near two requests to the first and leaving the second waiting long.
- Each agent appears in at most one assignment per batch.

## One-at-a-time offers (M6)

- The offer goes to one agent and shows a 20-second countdown, with sound and vibration.
- **The offer screen shows:**
  - category
  - fee (and service type)
  - pickup and drop-off areas, with the distance to each
  - whether the agent buys items
  - number of stops
  - now or scheduled
  - the customer's first name and initial, verified badge, rating and number of completed errands (as in the spec)
- Accept, decline, or let it time out.
- On decline or time-out, the errand goes to the next agent in ranked order. Re-rank when the list is more than 60 seconds old, so moving agents and new arrivals count.
- An agent who declines or times out isn't offered the same errand again.
- The customer sees "Finding an agent" with the search radius growing. They never see who declined.

## Accepting safely (M7)

- An offer is accepted with a single conditional database update. It succeeds only if the offer is still open, is addressed to this agent and hasn't expired, and the errand is still unassigned. Then the fee is locked in escrow in the same transaction (security plan L4).
- In the broadcast fallback (M8), the first committed update wins. Everyone else immediately sees "This errand was taken."
- Test: 50 accept requests at once from different agents produce exactly one assignment and one escrow lock.

## Radius steps and last resort (M8)

1. **Step 1:** 3 km search radius. Up to 5 one-at-a-time offers.
2. **Step 2:** 6 km. Up to 5 more offers.
3. **Step 3:** 10 km. Up to 5 more offers.
4. **Last resort:** broadcast to every eligible agent within 10 km. The first to accept gets it.

- The radius steps and offer counts are admin settings per state.
- The customer timers stay as in the spec. At 15 minutes the customer is asked to raise the price or keep waiting. At 30 minutes the request expires, and nothing needs refunding. A raised price restarts at step 1 with the agents who declined included again, because the fee changed.
- This replaces the spec's "widens to a larger radius once after 5 minutes".

## Acceptance rate (M9)

- **How it's measured:** the share of the agent's last 50 counted offers that they accepted.
  - Declining or ignoring a counted offer lowers it.
  - Accepting raises it.
  - Withdrawing after accepting counts as a cancellation (M4) and lowers reliability.
- **Offers that don't count**, following Bolt's optional orders:
  - pickup more than 3 km away
  - broadcast offers
  - back-to-back offers
  - offers arriving within 2 minutes of going online

  The offer screen marks these with an orange border, so agents know declining is free.
- **Shown in the agent app:** acceptance rate, completion rate and cancellations, beside rating.
- **Effect:** a low acceptance rate only lowers ranking. Admin can set a level below which an agent is paused from offers for a set time (default off).

## Back-to-back offers (M10)

This follows Uber's back-to-back trips.

- An agent on an errand can get the next urgent offer once:
  - they are within 1 km of the final drop-off, or
  - they have marked the errand delivered
- The next pickup must be within 3 km of that drop-off. Travel time counts the rest of the current errand plus the drive.
- At most one errand can wait behind the current one. It starts only after the current errand completes.

Built as above (Settings, Matching: on, 1 km and 3 km to start). A back-to-back offer never counts toward the
agent's acceptance rate, nor toward the missed offers that take them offline. Its travel time is estimated: the rest
of the way to the drop-off, then the drive; once delivered, from wherever the agent is, as for any agent. The next
errand starts once the current one is handed over: its PIN entered, or its drop-off photo sent. Only one-at-a-time
offers go back to back; an errand open to everyone still goes to agents holding nothing urgent.

## Open board (M11)

- The board lists non-urgent and scheduled errands that pass eligibility (M1), first to accept wins, using the same atomic accept (M7).
- **Default order "Best for you":** pickup travel time first, then fee per km, then newest. Agents can switch to nearest, highest fee or newest.
- Board views don't affect acceptance rate.
- The board refreshes live over Socket.IO, and a taken errand disappears at once for everyone.

## Scheduled errands (M12)

- Agents accept scheduled errands from the board in advance, as with Bolt scheduled rides. Only agents with a completion rate of 50% or more can accept them (Bolt uses the same bar).
- The agent must be online 15 minutes before the start.
- If they aren't online 10 minutes before the start:
  - the errand is taken back and dispatched as urgent (M6)
  - the agent's reliability drops as for a cancellation
  - the customer is told a new agent is being found
- An agent with a scheduled errand gets no urgent offers whose expected finish would make them late for it.

Built as above (Settings, Matching: 50%, 15 and 10 minutes to start). A new agent, with no accepted errands to
count, can take scheduled errands. "Online" is as the agent last set it. Being late is estimated at the fallback
speed: to the urgent errand's pickup, along its stops, then to the scheduled one's pickup by its start, after
finishing an errand they are on first. Such an errand isn't offered to them, isn't on their board, and can't be
accepted however it is taken.

## After launch (M13)

- **Destination mode:** an agent sets a destination, such as home, up to twice a day, and gets only errands whose drop-off brings them closer. Uber and Bolt both offer this. Built: offers, the board and accepting all keep to errands whose drop-off is at least 20% of the way nearer, in a straight line; it ends within a km of the destination, when cleared, or at the end of the day it was set (Settings, Matching: on, twice a day, 20%). Offered one back to back, the errand is measured from the current one's drop-off. The agent app sets it from the board.
- **Multi-errand batching:** like DoorDash, one agent carries two errands with nearby pickups at once. This needs separate escrows per errand and changes to the tracker, so it isn't built until volume needs it.
- **Acceptance prediction:** once there's enough history, add each agent's predicted chance of accepting this errand to the ranking, as DoorDash does. Built: each offer keeps what it looked like to the agent (how far the pickup, how long the trip, the fee, their acceptance rate, the hour, whether they buy). Nightly, each state with 500 answered offers in the last 60 days gets a logistic model of who takes what, and a fifth of each agent's ranking score then goes by their chance of taking it (Settings, Matching). Until a state has a model, or once one is a week old without refitting, ranking is as without it. The Matching page lists each state's model.

## Admin settings, group Matching (M14)

Per state where it makes sense, versioned, and changed only with two-person approval (security plan D4). Built: the
offer and ranking values can be set per state, city and area as well as per country, each from the nearest level
that sets it (Settings, Places; [admin-panel.md](admin-panel.md)). Who may get an errand and the acceptance rate stay
per country.

- batch interval (3 s), offer window (20 s), shortlist size (10)
- radius steps (3, 6, 10 km) and offers per step (5)
- ranking weights (60/20/10/10) and tier boosts (0)
- new-agent history needed (20 offers, 10 errands)
- counted-offer rules (3 km, 2 minutes) and the optional pause level (off)
- back-to-back distances (1 km, 3 km)
- scheduled-errand bar (50%) and online deadline (15 minutes)
- location freshness (2 minutes) and ping intervals (10 s, 60 s)

## Admin dashboard and logs (M15)

Built: the panel's Matching page, the offer log on an errand's page, and the figures on an agent's page
([admin-panel.md](admin-panel.md)). Arrival at the pickup is the agent's first position within 150 m of it.

- **Per state and category:**
  - time to first offer and time to accept
  - offers per errand
  - share reaching the last-resort broadcast, and share expiring
  - predicted versus actual pickup time
- **Per agent:** acceptance rate, completion rate, cancellations, offers received.
- **Every offer is logged:** errand, agent, score and its parts, the offer, the response and its time. Admin can open an errand and see who was offered it in what order and why. This is needed for disputes and for fairness complaints.

## Changes to features already built

- **Urgent push** changes from "send to the nearest agents, first to accept wins" to ranked one-at-a-time offers (M4–M7). Broadcast becomes the last resort (M8).
- **"Widen once after 5 minutes"** becomes radius steps (M8).
- **New agent-app items:** the offer screen with countdown and orange border (M6, M9), and acceptance rate, completion rate and cancellations on the profile (M9).
- **Back-to-back offers** (M10) and the **scheduled-errand rules** (M12).
- **Board default order** "Best for you" (M11).
- **New admin settings group** Matching (M14) and the matching dashboard (M15).

## Tests

- **Ranking:** given fixed agents, the expected agent gets the first offer, and changing a weight changes the order as expected.
- **Batching:** two requests and two agents placed so that greedy nearest-first gives a worse total than the Hungarian assignment; the batch must pick the better total.
- **Offers:** time-out moves to the next agent, a decliner is never re-offered, and an agent never holds two offers at once.
- **Race:** 50 simultaneous accepts give one assignment and one escrow lock (M7).
- **Simulation:** a seeded script with 200 agents and 500 errands in Lagos, reporting time to accept, expiries and how evenly errands spread across agents. It runs in CI and fails on a large regression.
