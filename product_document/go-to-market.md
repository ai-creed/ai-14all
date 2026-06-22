# ai-14all — Go-to-Market Narrative & Theme

> **What this document is.** A go-to-market narrative, brand theme, and launch plan for
> ai-14all, built on `product_document/product_brief.md` and `product_document/product-prd.md`.
> It defines the positioning spine, the chosen creative theme (and an explicit critical
> rationale for it), and three ready-to-use artifacts: a narrative one-pager, landing-page
> copy, and a 4-week content calendar.
>
> **Audience & motion (from the PRD §2.3):** individual senior/prosumer engineers who already
> run AI coding-agent CLIs and want to run several at once. Bottom-up, founder-led,
> community-seeded. Pre-revenue, donation-supported, source-available.

---

## 0. The strategic constraint (read this first)

The headline feature — *"parallel agents across git worktrees"* — **is being commoditized by
the platform owners** (Claude Code desktop, Cursor 2.0, GitHub Agent HQ all shipped it, free,
inside the subscription — PRD §1.2 #8, §1.3 Group D). So the narrative **cannot be the feature.**
It must be the **wedge the first parties structurally cannot copy** (PRD §2.4):

1. **Cross-vendor neutrality** — one cockpit over Claude *and* Codex *and* others. Anthropic
   will never orchestrate Codex for you.
2. **You stay the gatekeeper** — supervised, human-in-the-loop, *"not a swarm."*
3. **Local-first** — real PTYs, no network telemetry, your code never leaves the machine.

Each maps onto a cultural headwind already in the air (trust paradox, token-cost panic, AI-slop
backlash — PRD §1.2). The market is handing us the narrative.

---

## 1. Creative theme — inverted Severance (critical rationale)

**Chosen aesthetic:** the visual + copy language of *Severance* (Apple TV+), **deliberately
inverted.**

**Why it is dangerous to borrow straight.** *Severance* is a dystopia about a corporation that
severs people from their autonomy, surveils them, and harvests labor they don't understand. That
is the *exact inverse* of ai-14all's values — local-first, no telemetry, human-in-the-loop, you
stay the gatekeeper. Adopting Lumon's voice and values straight would brand us as the villain we
differentiate against, and torch the one thing this GTM runs on: **trust**. Additional risks:
Apple TV+ owns the marks (Lumon / Kier / MDR / the logo / "Praise Kier") — evoke the *genre*,
never lift the *marks*; the look is *saturated* post-S2 (2025); and Lumon's currency is deception
while ours is honesty — it only lands if it is *obviously winking*.

**Why the inversion works.** A git worktree is **literal severance**. Each agent is sealed into
its own isolated floor, doing mysterious refinement work, unable to touch the others. The
**agents are the innies. You are the one person who is *not* severed** — you see every floor at
once, and nothing leaves the building without you. This flips the message from "creepy
corporation surveils you" to **"you run the floor, and you kept your autonomy."** The aesthetic
gives us the eerie-calm green-CRT cool for free (and it rhymes with the terminal-first product
and its existing opt-in terminal theme); the *substance* stays 100% on-brand.

**The ownable hook:** **"Your agents are severed. You're not."**

**Guardrails:**
- Inverted-Lumon is a **launch *campaign* skin over the durable "mission control / you're the
  senior engineer" spine** — not the permanent core-values voice.
- **Never use Apple's marks.** "Severed," "floor," "refinement" are dictionary words that happen
  to resonate — that is the line we stay behind.
- On HN and r/ExperiencedDevs, **dial the costume down**; lead with the wedge, let the aesthetic
  be seasoning.

**Source grounding (researched June 2026):**
- Severance design language — mid-century-modern + brutalist + retro-futurism (Jeremy Hindle);
  Saarinen's Bell Works inverted into control/dehumanization; Dieter Rams minimalism; green CRT
  terminals + trackball; deep-green/sterile-white palette.
  [designboom](https://www.designboom.com/design/severance-closer-look-mid-century-brutalist-retro-futuristic-universe-lumon-03-21-2025/),
  [urdesignmag](https://www.urdesignmag.com/architecture-severance-apple-tv-series-lumon-design/)
- Severance copywriting — flowery-yet-precise corporate dialect tipping into the ominous; *"The
  work is mysterious and important"*; founder-as-god, aphorisms as scripture, the Compliance
  Handbook.
  [Salon](https://www.salon.com/2025/02/15/severance-and-the-important-mysterious-job-of-speaking-the-language-of-work/),
  [Severance Wiki](https://severance-tv.fandom.com/wiki/Compliance_Handbook)

---

## 2. Narrative one-pager

**Product:** ai-14all — mission control for parallel AI coding agents.

**The big idea (positioning spine):** *Everyone else is selling autonomous swarms. We sell you
the chair at the front of the room.* You fan work out to a floor of severed agents — each sealed
in its own worktree — and you're the only one who sees all of it and decides what ships.

**The villain (what we're against):** the autonomy hype cycle — vendor walled gardens that
orchestrate only their own model, harvest your telemetry, and ask you to *trust the magic*. The
category's own data is our ammunition: 90% adoption but collapsing trust, 45% of AI code ships a
vuln, Uber torched a year's token budget in four months (PRD §1.2).

**The wedge (what they can't copy):**
1. **Cross-vendor neutrality** — one cockpit over Claude Code *and* Codex *and* others.
2. **You stay the gatekeeper** — supervised, human-in-the-loop, nothing merges without you.
3. **Local-first** — real PTYs, no network telemetry, your code never leaves the machine.

**Messaging pillars (every asset ladders to one):**

| Pillar | One-liner | Proof point | Headwind it answers |
|---|---|---|---|
| **Severed, by design** | "Each agent, sealed in its own worktree." | session-per-worktree isolation | insecure/colliding AI code |
| **You see every floor** | "It tells you which agent needs you." | attention model + MCP self-report | swarm chaos / loss of control |
| **One supervisor, every vendor** | "Claude. Codex. Whatever's next. One window." | cross-vendor neutrality | first-party lock-in |
| **Nothing leaves the building** | "Local-first. No telemetry. Ever." | no network telemetry | IP leakage / surveillance |
| **Watch the meter** | "See the tokens before the bill does." | live token telemetry + budgets | token-cost panic |

**Brand voice:** deadpan, clinical, dryly funny — Lumon's *cadence* with the developer's
*values*. Precise, terse, a little eerie, never hype. The joke is the contrast: corporate-dystopia
surface, radically pro-user substance.

**Audience & motion:** individual senior/prosumer engineers already running agent CLIs;
bottom-up, founder-led, community-seeded. Beachhead = the local-first, cross-vendor, hype-skeptical
tribe the first parties ignore.

**The line:** **Your agents are severed. You're not.**

---

## 3. Landing-page copy

> Voice note: inverted-Lumon deadpan on top, plain-engineer substance underneath. Eerie-calm
> hero → reassuringly concrete features.

**[Hero]**

# Your agents are severed. You're not.

### Mission control for parallel AI coding agents. Each one sealed in its own worktree. You're the only one who sees the whole floor.

`[ Download for macOS (Apple Silicon) ]` · `[ View source ]`

<small>Local-first. No network telemetry. It never phones home — because there's no home to phone.</small>

**[The eerie one-liner band]**

> Please enjoy each agent equally.

**[Problem]**

## Fourteen terminals is not a workflow.

You're already running a floor of agents — a Claude here, a Codex there, a dev server, a test
runner. Across a dozen tabs and four windows. The work isn't the problem. *Keeping track of it* is.

**[Pillars — 4 cards]**

**Severed by design.** Every agent gets its own git worktree, branch, and real PTY shell. They
can't touch each other's files. Refinement happens in isolation — the way it should.

**You see every floor.** The sidebar tells you which agent is *waiting*, *failed*, *ready*, or
just idling — rolled up so the most urgent one wins. Agents report their own status over a local
MCP server. No more guessing from scrollback.

**One supervisor. Every vendor.** Claude Code. Codex. Whatever ships next. One window over all of
them — because your cockpit shouldn't be owned by the model vendor.

**Nothing leaves the building.** Real terminals, signed and notarized, running on *your* machine.
No network telemetry, ever. Your code is yours. Praise no one.

**[Supervision section]**

## Not a swarm. A supervised floor.

Everyone else is selling autonomy. We think you should still be the one who hits merge. Review
every diff in-window — read-only Monaco, inline comments, commit history — then keep it or discard
it. Nothing ships without you.

**[Token telemetry]**

## Watch the meter before the bill does.

Live per-agent token usage, plan tiers, and editable budgets. Uber burned a year of AI budget in
four months. You'll see yours tick up in real time.

**[The honest section — builds trust by saying what it ISN'T]**

## What this is not.

- **Not an IDE.** It orchestrates and reviews. Keep your editor.
- **Not a swarm.** You're the gatekeeper, by design.
- **Not autonomous magic.** The agents do the refinement. You do the deciding.
- **Not for everyone.** Apple Silicon only, today. One-off single-agent users don't need it.

**[Footer band]**

# The work is parallel. The judgment is yours.

`[ Download for macOS (Apple Silicon) ]`

<small>Source-available · Free · Donation-supported · Built by one human at ai-creed.dev</small>

---

## 4. Content calendar — first 4 weeks

**Arc:** tease the eerie aesthetic → launch hard on HN with the *honest* substance → news-jack
the category's pain → settle into the durable identity. Each post ladders to a pillar.

### Week 0 — The Tease (build curiosity, no product yet)

| Ch | Post | Angle |
|---|---|---|
| X/Twitter | 8-sec clip: green-CRT terminal, four panes, one lights up `WAITING`. Caption: *"Your agents are severed. You're not. Soon."* | aesthetic hook, no explainer |
| X/Reddit | "I gave each of my coding agents its own sealed floor. Here's why." (worktree-isolation think-piece) | Severed by design |
| GitHub | README + landing go live behind the tagline; star-seed in your circles | — |

### Week 1 — Launch (the big one)

| Ch | Post | Angle |
|---|---|---|
| **Hacker News** | **Show HN: ai-14all — local-first mission control for parallel AI coding agents.** Lead with *honest* substance (cross-vendor, no telemetry, "supervised, not a swarm"), keep the Severance wink to *one* line. HN punishes hype — let the wedge speak. | full spine |
| Reddit ×3 | r/ClaudeAI + r/ChatGPTCoding ("the cockpit for your Claude Code + Codex fleet"), r/LocalLLaMA ("no telemetry, runs entirely local"), r/commandline ("real PTYs, not a web UI") | tailored pillar per sub |
| X thread | Founder "why I built this" + the 8-sec aha clip | You see every floor |
| YouTube/Shorts | 60-sec "how I run 5 agents without losing my mind" | demo |

### Week 2 — News-jack the pain (features as answers to live headlines)

| Ch | Post | Hook |
|---|---|---|
| Blog → HN/Reddit | "Uber burned its 2026 AI budget in four months. Here's a live meter so you don't." | token telemetry |
| X | "45% of AI code ships a vuln (Veracode). That's why nothing here merges without you reviewing the diff." | supervision pillar |
| Reddit r/ExperiencedDevs | "The trust paradox: 90% adoption, nobody trusts it. Maybe stop pretending it's autonomous." | "not a swarm" |

### Week 3 — Differentiate + community

| Ch | Post | Hook |
|---|---|---|
| Blog | Honest "vs. first-party" piece: "Claude Code desktop does worktrees too — but it only drives Claude. The cross-vendor case." | cross-vendor wedge |
| GitHub | PR into `awesome-claude-code` / `awesome-ai-agents` lists | discovery |
| Discord/Slack | Show up in Claude Code / Codex / local-first servers as a *complement*, not a pitch | seeding |
| X | Ship the opt-in **green-CRT terminal theme** as an easter egg; clip it. (Name it something original — not "Lumon.") | aesthetic payoff + product tie-in |

### Week 4 — Identity lock-in

| Ch | Post | Hook |
|---|---|---|
| YouTube creators | Get into 1–2 AI-coding YouTubers' real workflow videos (not ads) | credibility |
| Lobsters | The architecture essay (local-first, narrow IPC, no telemetry) for the high-signal crowd | trust |
| X recurring | "Floor report" — weekly build-in-public update in deadpan-Lumon voice | durable identity |

**Whole-calendar guardrails:**
- On HN / r/ExperiencedDevs, **dial the Severance bit down** — those rooms reward substance and
  smell costume. Lead with the wedge; let the aesthetic be seasoning.
- **Never use Apple's marks** (Lumon / Kier / MDR / the logo). "Severed," "floor," "refinement"
  are dictionary words that happen to resonate — that is the line we stay behind.

---

## Channel priority (reference)

1. **Hacker News "Show HN"** — highest leverage; this *is* the audience. Honesty mandatory.
2. **Reddit** — r/ClaudeAI, r/ChatGPTCoding, r/LocalLLaMA, r/commandline, r/ExperiencedDevs, r/macapps.
3. **X/Twitter** — founder build-in-public + short looping demo clips.
4. **GitHub** — README, awesome-lists, trending.
5. **YouTube workflow creators** — get into the videos, don't buy ads.
6. **Discord/Slack** — agent + local-first communities, as a complement.
7. **Lobsters + long-form essay** — high-signal crowd.

*(Skip TikTok/Instagram as primary; one well-cut clip cross-posts to X video + YouTube Shorts.
Product Hunt is secondary — not where terminal people live.)*
