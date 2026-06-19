# ai-14all — Business Value Mapping

> **What this document is.** A reverse-engineered business/market context for ai-14all,
> built backward from `product_document/product_brief.md`. It answers the Business Value
> Mapping questions across two areas: **Market Attractiveness** and **Business Model**.
>
> **Sources & method (no fabrication):**
> - *Product facts* come from the repo and `product_brief.md`.
> - *Business-model facts* (revenue model, stage, customer base, market framing) were
>   **provided directly by the product owner** — they are not derivable from the codebase
>   and were not invented here.
> - *Market metrics* (size, growth, competitors, head/tailwinds) come from **dated, cited
>   web sources**, gathered June 2026. Every figure carries a source and a confidence flag.
>
> **Confidence conventions for cited metrics:**
> **HIGH** = read off a primary source (report page, official survey/press release).
> **MEDIUM** = official figure surfaced via reputable secondary reporting, or a primary
> page that blocked direct fetch. **LOW** = single secondary aggregator / self-reported,
> not independently corroborated. Items marked *(inference)* are analysis, not sourced fact.
> **Source independence:** sources with a commercial stake in a finding are flagged for conflict
> of interest and, where possible, corroborated against opposite-incentive sources (see the Stack
> Overflow note in §1.2).
>
> Several 2025–2026 valuations and product launches are fast-moving; figures are flagged
> accordingly. Where no credible figure exists, that is stated explicitly rather than guessed.

---

## Part 1 — Market Attractiveness

### 1.1 What industry / segment is the business in?

ai-14all sits at the intersection of several named segments. From broadest (the framing the
product owner selected to anchor projections) to most precise:

1. **AI developer tools / DevOps tooling (anchor framing)** — software development tooling
   augmented by AI across the SDLC. *This is the framing chosen to anchor the growth
   projection (§1.4).*
2. **AI coding assistants / AI code tools** — the best-*measured* sub-segment and the
   closest reportable proxy (see §1.4 caveat).
3. **Agentic AI / AI agents** — because ai-14all orchestrates *autonomous coding agents*, it
   rides the agentic-AI wave.
4. **Multi-agent (coding) orchestration / supervision** — the most precise functional
   description of the product, but a niche with **no tier-1 market-size report of its own**.

**Most precise label:** *a terminal-first, cross-vendor multi-agent coding orchestrator /
supervisor* within the **AI coding-assistant** layer of the **AI developer-tools** market,
riding the **agentic-AI** wave. *(inference — not a sourced taxonomy.)*

### 1.2 Headwinds (challenges) and tailwinds (opportunities)

**Headwinds — challenges impacting category growth** *(refreshed to early/mid-2026 sources)*

| # | Headwind | Evidence (freshest available) | Confidence |
|---|----------|-------------------------------|-----------|
| 1 | **Eroding trust in AI accuracy** | *Anchored on cross-incentive sources.* Google **DORA 2025** (~5,000 devs; Google *sells* AI coding tools → opposite bias): only **24% trust AI "a lot/a great deal," while 30% trust it "a little/not at all"** — the **"trust paradox"** (90%+ adoption, limited trust); DORA 2024 was **39% little/no trust**. **GitLab 2025** (a tool vendor): only **37% would trust AI without human review**; 73% hit problems with "vibe-coded" code. Stack Overflow *confirms the direction* (trust in accuracy 29% in 2025, down from 40%; 45.7% actively distrust) but ⚠️ **carries a conflict of interest** (see source-credibility note below). Optimistic counter-pole: GitHub's own surveys (97% adoption, 90% perceive a quality increase). | HIGH (corroborated across opposing incentives) |
| 2 | **Insecure AI-generated code** | Veracode, *Spring 2026 GenAI Code Security Update* (**Mar 2026**): **45% of AI-generated code contains a known vulnerability** — a pass rate **flat for two years** despite 95%+ syntax correctness; XSS passes only 15%. GitGuardian (**Mar 2026**): Claude-Code-assisted commits leak secrets at **3.2% vs 1.5% baseline (~2×)**. | HIGH |
| 3 | **IP / source-code leakage & data governance** | GitGuardian, *State of Secrets Sprawl 2026* (**Mar 2026**): **28.65M new hardcoded secrets** pushed to public GitHub in 2025 (**+34% YoY**); **24,008** secrets exposed in MCP config files in year one. Incident: InfoWorld (**Apr 2026**) — a Claude Code source/orchestration leak pushed enterprises toward environment isolation and stronger indemnity clauses. | HIGH |
| 4 | **Productivity skepticism / unproven ROI** | METR follow-up (**Feb 2026**) to its 2025 "**19% slower**" RCT: a late-2025 re-run flipped directionally toward speedup, but METR calls it **"only very weak evidence"** and an **"unreliable signal"** (30–50% of devs declined tasks → severe selection bias). Self-reports remain unreliable (prior study overestimated time savings by 40 pts). Anchor (DATED): MIT NANDA — **95% of enterprise GenAI pilots showed no measurable P&L impact** (Jul 2025). | HIGH |
| 5 | **Agentic-project failure / governance friction** | Gartner *Hype Cycle for Agentic AI* (**Apr 2026**): only **17% of orgs have deployed AI agents** (60%+ expect to within 2 years); agentic AI sits at the **Peak of Inflated Expectations** — i.e., a disillusionment phase is the *anticipated next step*, not the current state. Trajectory anchor: Gartner — **>40% of agentic-AI projects will be canceled by end of 2027** (Jun 2025); warns of "agent washing." | MEDIUM (Apr-2026 figures via secondaries) |
| 6 | **Token/inference cost of agentic & parallel workflows** | Fortune (**May 2026**): Uber **exhausted its full-year 2026 Claude Code budget in ~4 months**, with its COO questioning whether the spend maps to measurable feature output. Fortune (**May 2026**): Microsoft reportedly canceled most direct Claude Code licenses ~6 months in. Structural anchor: Anthropic — multi-agent systems use **~15× the tokens** of a chat (Jun 2025). | HIGH / MEDIUM |
| 7 | **Autonomous-agent reliability & broken benchmarks** | OpenAI **stopped reporting SWE-bench Verified** (**Feb 2026**): in audited repeatedly-failed problems, **≥59.4% had flawed test cases**, plus contamination signals — the flagship coding benchmark effectively disowned by a major lab. SWE-bench Pro (**Jun 2026**): standardized scores run **10–30 pts below vendor-reported**; reliability collapses across retries. | MEDIUM |
| 8 | **Incumbents commoditizing parallel-agent orchestration** | Anthropic Claude Opus 4.8 *"dynamic workflows"* (**May 2026**): Claude Code can run **"hundreds of parallel subagents in a single session"** — and ships first-class git-worktree isolation. GitHub **Agent HQ + Mission Control** (public preview **Feb 2026**) bundles third-party agents (Claude, Codex, Jules, Cognition, xAI) into the paid Copilot subscription. Cursor 3.2 (**Apr 2026**) added `/multitask` async subagents + worktrees. ai-14all's core feature is being absorbed by platform owners. | HIGH / MEDIUM |

> **Source-credibility note — Stack Overflow's conflict of interest.** Stack Overflow is
> **not a neutral source** on AI coding tools: AI assistants directly cannibalize its Q&A
> business — new-question volume fell **~78% YoY by Dec 2025** (DevClass, via SO's own Data
> Explorer) and the company cut **~28% of staff in Oct 2023** — giving it a motivated incentive
> to emphasize AI's unreliability. We therefore (a) treat its Developer Survey as a useful but
> *interested* instrument rather than a neutral one, and (b) anchor the trust headwind on
> **cross-incentive corroboration**: Google **DORA** (Google sells AI coding tools) and **GitLab**
> (a vendor) independently report the same direction and rough magnitude of distrust, and neutral
> academic studies (Perry et al., Stanford; Shah et al.) concur — so the finding does **not** rely
> on SO. *Two honest caveats:* SO's decline began ~2014 and only *accelerated* after ChatGPT (not
> solely AI-caused), and SO itself disputed the larger "35–50% traffic" collapse figures as a
> Google-Analytics artifact — so we cite the undisputed *question-volume* decline, not traffic.

**Tailwinds — opportunities driving category growth** *(refreshed to early/mid-2026 sources)*

| # | Tailwind | Evidence (freshest available) | Confidence |
|---|----------|-------------------------------|-----------|
| 1 | **Agentic AI / multiagent systems are the dominant analyst trend** | Gartner *Top 10 Strategic Tech Trends for 2026* (**Oct 2025**): Agentic AI and **Multiagent Systems** headline; **40% of enterprise apps to use multiagent systems by end of 2026** (from <5% today). McKinsey, *"State of AI trust in 2026: shifting to the agentic era"* (**Apr 2026**): **23% of orgs already scaling agentic AI, 62% experimenting.** | MEDIUM |
| 2 | **CLI / agent fragmentation keeps expanding** | Tembo, *"2026 Guide to Coding CLI Tools"* (**Feb 2026**): **15 distinct CLI agents** compared (Claude Code, Codex, Gemini CLI, Copilot CLI, Amp, Aider, Warp, Droid, Goose, Cline…). A multi-vendor, still-growing field is the direct demand driver for a *cross-vendor* supervisor. | HIGH |
| 3 | **Model capability is plateauing → bottleneck shifts to orchestration** | By **Apr 2026**, frontier models cluster tightly (~80% on SWE-bench Verified) — described as a "temporary plateau" on single-repo bug-fixing. With raw capability converging, the open problem becomes *coordinating* capable agents. | MEDIUM |
| 4 | **Parallel / multi-agent demonstrably outperforms single agents (fresh evidence)** | arXiv *"Scaling Test-Time Compute for Agentic Coding"* (**Apr 2026**): parallel scaling lifts Claude-4.5-Opus **70.9% → 77.6%** on SWE-bench Verified and 46.9% → 59.1% on Terminal-Bench v2. *"Agyn"* multi-agent system (**Feb 2026**): **72.2% vs 65.0%** single-agent baseline (+7.2 pts). (Caveat: gains shrink where single-agent baselines are already very high.) | HIGH |
| 5 | **Parallel-agent + git-worktree is now a productized practice** | Claude Code shipped **built-in git-worktree support** (2026 docs): a `--worktree` flag and **`isolation: worktree` so subagents run in their own worktrees in parallel without conflicts** — productizing exactly ai-14all's pattern. Dedicated orchestrators (Conductor, Vibe Kanban, Claude Squad, etc.) continue to proliferate through 2026. | HIGH (tooling exists) / MEDIUM (adoption magnitude) |
| 6 | **Mainstream developer adoption with emerging ROI evidence** | JetBrains (**Apr 2026**, Jan-2026 survey of 10K+ devs): **90% regularly use ≥1 AI tool at work; 74% use specialized coding tools/agents**; Claude Code at 18% (~6× growth from mid-2025). DORA ROI follow-up (**May 2026**): modeled **~39% first-year ROI, ~8-month payback.** | HIGH |
| 7 | **Capital & revenue momentum in agentic coding** | Cursor/Anysphere: **~$2B ARR by Feb 2026**, ~$50B valuation round (Apr 2026). Anthropic: ~**$30B revenue run-rate** (Apr 2026), Claude Code ~$2.5B. Cognition (Devin/Windsurf): **$1B+ at ~$26B** (May 2026), ~$492M ARR. The category is richly capitalized. | MEDIUM |
| 8 | **Enterprise AI budgets growing into 2026** | a16z (**Jan 2026**, 100+ Global-2000 execs): per-enterprise LLM spend expected **+~65% in 2026 (~$7M → ~$11.6M).** Menlo Ventures (Dec 2025): enterprise AI spend hit **$37B in 2025 (3× YoY); coding & dev tools = $7.3B.** | HIGH / HIGH (Menlo is 2025 retrospective) |

### 1.3 Key competitors

ai-14all's strict definition (local, terminal-first, cross-vendor, human-supervised parallel
agents across git worktrees) puts its closest rivals in **Group A**. Adjacent groups can
expand into its lane.

**Group A — Direct: parallel/multi-agent orchestrators & git-worktree session managers**

| Competitor | What it is | Relation | Funding / scale (sourced) |
|---|---|---|---|
| **Conductor** (Melty Labs) | Mac app running multiple Claude Code/Codex/Cursor agents in parallel, one git worktree each, unified review/merge | **Most similar direct rival** | YC S24; ~$500K seed (LOW) |
| **Crystal / "Nimbalyst"** (Stravu) | Electron app, parallel Claude Code + Codex sessions in worktrees | Direct (repo renamed/sunset) | OSS (MIT); no public funding |
| **Vibe Kanban** (Bloop AI) | Kanban over many agent CLIs; per-task worktree + terminal | Direct (company shut down ~Apr 2026; OSS continues) | Bloop ~$7.43M (LOW) |
| **Claude Squad** (smtg-ai, OSS — *not* Anthropic) | TUI managing many terminal agents via tmux + worktrees | Direct (TUI variant) | OSS, ~5.8K stars |
| **uzi** (devflowinc, OSS) | CLI running many agents in parallel via worktree + tmux; one-command merge | Direct (CLI, high fan-out) | OSS; no figure found |
| **Sculptor** (Imbue) | Mac app running parallel Claude Code agents in isolated **Docker containers** | Direct (container vs worktree isolation) | Imbue $200M Series B @ >$1B (corporate, 2023) |
| **cmux / AgentsRoom / Pane** (OSS/indie) | Terminal/desktop "cockpits" running any CLI across worktrees | Direct — the contested OSS ground | No figures found |
| **Terragon / Async** | Cloud orchestrators (sandboxes → PRs) | Adjacent (cloud, not local) | Terragon OSS/shut down; Async YC S25 |

**Group B — Agentic CLIs (the engines ai-14all orchestrates → complements, not rivals)**
Claude Code (Anthropic), OpenAI Codex CLI, Gemini CLI (Google), Aider, Cursor CLI. ai-14all
depends on these; cross-vendor support over them is its thesis. *(Note: their owners can also
compete — see Group D.)*

**Group C — IDE/editor-based AI agents (adjacent → increasingly direct)**
- **Cursor** (Anysphere) — **Cursor 2.0 (Oct 2025) added native multi-agent: up to 8 concurrent agents isolated via git worktrees/remote machines** — overlaps ai-14all. $900M @ $9.9B (Jun 2025). (HIGH)
- **Windsurf** — broken up 2025 (Google hired leadership ~$2.4B; Cognition bought assets ~$250M). Adjacent.
- **GitHub Copilot / Copilot Workspace** — agent mode (Feb 2025); Workspace folded into the cloud coding agent (2025). Adjacent → competitive.
- **Zed**, **Replit Agent** ($400M @ $9B, Mar 2026), **Warp** (AI terminal, Agent Mode). Adjacent.

**Group D — The single biggest strategic threat: first-party orchestration**
- **Claude Code redesigned desktop app** (Anthropic, reportedly Apr 2026): "built for parallel
  agentic work" — multi-session sidebar, integrated terminal, rebuilt diff viewer, and **each
  session gets its own isolated git worktree**. The platform owner shipping ai-14all's core
  feature, free, inside the subscription. (MEDIUM)
- Combined with **Cursor 2.0** and **OpenAI Codex cloud** (parallel sandboxes), *"parallel
  agents across worktrees" is being commoditized by incumbents.*

> **Competitive wedge (inference):** ai-14all's defensible position is **cross-vendor
> neutrality** (one supervisor over Claude Code *and* Codex *and* others — which no first-party
> tool offers), **terminal/CLI fidelity** (real PTYs, not a web UI), **local-first privacy**
> (no network telemetry), and **supervision/observability** (per-agent attention rollup) that
> the first parties don't prioritize. The genuinely contested ground is the OSS pack (Claude
> Squad, uzi, cmux, AgentsRoom, Pane), which competes on the same cross-vendor promise.

### 1.4 Projected growth rate of the target market (next 3–5 years)

**Anchor framing chosen by the product owner: "broader AI developer tools / DevOps."**

> **Honest caveat:** Research found **no tier-1 market-size report scoped to "AI developer
> tools" as a standalone segment**, and **none for "multi-agent / agent orchestration"
> specifically.** The defensible approach is to triangulate from the nearest *measured*
> proxies and present a **range**, not a single fabricated number.

**Best-available proxies (3–5 year horizon):**

| Proxy segment | Baseline | Projection | CAGR | Source | Confidence |
|---|---|---|---|---|---|
| **AI code assistants** | $8.14B (2025) | $127.05B by 2032 | **48.1%** | MarketsandMarkets | HIGH |
| **AI code tools** | $4.91B (2024) | $27.17B by 2032 | **23.8%** | Polaris Market Research | HIGH |
| **AI code assistants** | $8.51B (2025) | $42.90B by 2033 | **22.5%** | Grand View Research | MEDIUM |
| **AI code tools** | $7.37B (2025) | (to 2031) | **~26.2%** | Mordor Intelligence | LOW |
| **AI in software development** | $674.3M (2024) | $15.7B by 2033 | **42.3%** | Grand View Research | MEDIUM |
| **GenAI in SDLC** | — | +$1.70B (2024→2029) | **38.7%** | Research and Markets | MEDIUM |
| **Agentic AI** (the wave) | ~$7.06–7.55B (2025) | $93–199B (2032–34) | **~40–46%** | MarketsandMarkets / Precedence / Fortune BI | HIGH/MEDIUM |

**Planning takeaway:** Credible 3–5 year CAGR estimates for the relevant segments span
**~22% to ~48%**, with a defensible central planning range of **~25–40% CAGR**. Segment
baselines cluster around **$5–8.5B (2024–25)**. The wide spread reflects differing scope
definitions, so the doc deliberately states a **range with sources** rather than a single point
estimate. *(Macro context, not TAM: Gartner forecasts worldwide GenAI spending at $644B in 2025
and total AI spending at $2.5T in 2026 — MEDIUM — useful for backdrop only.)*

---

## Part 2 — Business Model

> The four answers below are **product-owner-provided** (not derivable from the repo). The repo
> only exposes an **FSL-1.1-ALv2** license, a **CLA**, and a single "may offer commercial
> editions" line — i.e., a *legal structure*, not an operating revenue model.

### 2.1 Growth stage

**Early-stage startup — pre-revenue.** *(product-owner-provided.)*

Corroborating product signals: first stable release **v0.1.0 on 2026-04-24**, now at **v0.9.2
(2026-06-15)** after ~19 releases in under two months; the high-level plan describes a
**"beta-ready personal MVP."** Consistent with a bootstrapped/solo or very small build in the
build-and-validate phase, focused on product-market fit rather than monetization.

### 2.2 How does it make money? / What does it sell? / Revenue model

**Primary revenue model: voluntary donations / sponsorship (community-supported).**
*(product-owner-provided.)*

- **What it "sells" today:** nothing. The application is **free and source-available**; there
  is no paid tier, license fee, or subscription in the product.
- **Monetization mechanism:** **voluntary financial support (donations / sponsorship)** from
  users who value the tool — i.e., a community-funded open project, not a commercial SaaS.
- **Status:** **pre-revenue.** Donations are a sustainability mechanism, not (yet) a business
  with predictable recurring revenue.
- **Optionality left open (not the current model):** the **FSL-1.1-ALv2** license (free for all
  uses *except* a "Competing Use," auto-converting to Apache-2.0 two years post-release) plus the
  **CLA** (which lets the project relicense contributions, including under future commercial
  terms) deliberately preserve a path to **future commercial editions**. This is *latent
  optionality recorded in the repo*, **not** an active revenue stream, and is documented here so
  it is not mistaken for one.

> *Implication (inference):* a donation model fits a pre-revenue, individual-developer, bottom-up
> product, but it is not a scalable revenue engine on its own. If/when monetization becomes a
> goal, the FSL+CLA scaffolding already supports pivoting to open-core or a commercial team
> edition without relicensing friction.

### 2.3 Primary customer base

**B2C / prosumer — individual developers.** *(product-owner-provided.)*

The target user is the **individual engineer who already runs AI coding-agent CLIs** and wants
to run several at once with structure around them (per `product_brief.md` "Who it is for"). The
motion is **bottom-up / self-serve** adoption, not top-down enterprise sales. Explicit
non-audiences (from the brief): single-agent one-off users, IDE-replacement seekers, and
Intel-Mac / Windows users (Apple-Silicon-only today).

### 2.4 Key differentiators

Grounded in `product_brief.md` and sharpened against the competitive landscape (§1.3):

1. **Cross-vendor agent neutrality** — orchestrates Claude Code, Codex, and other CLIs in one
   supervisor; not locked to a single model vendor. *The core defensible wedge versus first-party
   tools (Claude Code desktop, Cursor 2.0) that only orchestrate their own agent.*
2. **Terminal-first fidelity** — agents run in **real PTY shells** (xterm.js + node-pty), signed
   and working under the macOS hardened runtime — not a web UI or sandboxed abstraction.
3. **Session-per-worktree isolation** — every agent gets its own Git worktree + branch + terminal,
   so parallel agents never collide; worktrees are created/removed in-app.
4. **Agent attention model** — per-agent state (`waiting/failed/ready/active/idle/stale`) rolled up
   per session, with a built-in **MCP server** letting agents *self-report* status and task, so
   fanning out across many agents never loses track of who needs what.
5. **Supervised parallelism, not a swarm** — human-in-the-loop by design; the user is the
   gatekeeper and nothing merges/ships without them.
6. **Lightweight in-window review** — read-only Monaco diff viewing, inline diff comments, commit
   history, and keep/discard — review without a context switch to a full IDE.
7. **Local-first privacy** — no network telemetry collected; all state and logs stay local.
8. **Extensibility via an opt-in ecosystem plugin framework** — peer-app drivers (ai-whisper
   workflow lens, ai-cortex memory + code navigation) under a read-only, audit-logged, fault-isolated
   contract.
9. **Token telemetry** — live per-agent Claude/Codex token usage and budgets, directly addressing
   the category's cost headwind (§1.2 #6).

---

## Appendix — Sources & citations

*Market metrics, with publication context and confidence. URLs as gathered June 2026.*

**Market size / growth**
- MarketsandMarkets — AI Code Assistants ($8.14B 2025 → $127.05B 2032, 48.1%). HIGH. https://www.marketsandmarkets.com/Market-Reports/ai-code-assistants-market-53503659.html
- Polaris Market Research — AI Code Tools ($4.91B 2024 → $27.17B 2032, 23.8%). HIGH. https://www.polarismarketresearch.com/press-releases/ai-code-tools-market
- Grand View Research — AI Code Assistants ($8.51B 2025 → $42.90B 2033, 22.5%). MEDIUM. https://www.grandviewresearch.com/industry-analysis/ai-code-assistants-market-report
- Mordor Intelligence — AI Code Tools ($7.37B 2025, ~26.2%). LOW. https://www.mordorintelligence.com/industry-reports/artificial-intelligence-code-tools-market
- Grand View Research — AI in Software Development ($674.3M 2024 → $15.7B 2033, 42.3%). MEDIUM. https://www.grandviewresearch.com/industry-analysis/ai-software-development-market-report
- Research and Markets — GenAI in SDLC (+$1.70B 2024→2029, 38.7%). MEDIUM. https://www.globenewswire.com/news-release/2025/08/14/3133678/0/en/The-Market-for-Generative-AI-in-Software-Development-Lifecycle-2025-2029-Global-Revenues-to-Grow-by-1-7-Billion-at-38-7-CAGR.html
- MarketsandMarkets — Agentic AI ($7.06B 2025 → $93.20B 2032, 44.6%). HIGH. https://www.marketsandmarkets.com/Market-Reports/agentic-ai-market-208190735.html
- Precedence Research — Agentic AI ($7.55B 2025 → $199.05B 2034, 43.84%). HIGH. https://www.precedenceresearch.com/agentic-ai-market
- Gartner — GenAI spending $644B (2025); total AI spending $2.5T (2026). MEDIUM (context only). https://www.gartner.com/en/newsroom/press-releases/2025-03-31-gartner-forecasts-worldwide-genai-spending-to-reach-644-billion-in-2025

**Adoption**
- Stack Overflow Developer Survey 2025 (84% use/plan AI; 31% use agents; 46% distrust accuracy). HIGH. https://survey.stackoverflow.co/2025/ai
- JetBrains State of Developer Ecosystem (Jan 2026 data: 90% use ≥1 AI tool; 74% specialized; Claude Code 18%). HIGH. https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/
- Google DORA 2025 (90% use AI at work; ~30% little/no trust). HIGH. https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report
- GitHub Copilot >20M users (Jul 2025). MEDIUM. https://dataconomy.com/2025/07/31/github-copilot-now-has-over-20-million-users/

**Headwinds** *(early/mid-2026 refresh)*
- *Trust — cross-incentive corroboration (preferred anchors):*
  - Google **DORA 2025** — "State of AI-assisted Software Development" (24% high trust vs 30% little/no trust; "trust paradox"; ~5,000 devs), **Sep 2025**. HIGH. https://blog.google/innovation-and-ai/technology/developers-tools/dora-report-2025/
  - Google **DORA 2024** — Accelerate State of DevOps (39% report little/no trust in AI-generated code), Oct 2024. HIGH. https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report
  - **GitLab Global DevSecOps 2025** — "The AI Paradox" (only 37% would trust AI without human review; 73% hit vibe-coding problems; 3,266 pros), **Nov 2025**. HIGH. https://about.gitlab.com/press/releases/2025-11-10-gitlab-survey-reveals-the-ai-paradox/
  - Perry et al. (Stanford) — "Do Users Write More Insecure Code with AI Assistants?" (AI users wrote less-secure code but believed it more secure), ACM CCS 2023. HIGH. https://arxiv.org/abs/2211.03622
- *Stack Overflow (interested source — confirming, not anchoring; see §1.2 note):*
  - SO Blog — "Closing the developer AI trust gap" (trust fell to 29% in 2025, −11 pts), **Feb 2026**. HIGH. https://stackoverflow.blog/2026/02/18/closing-the-developer-ai-trust-gap/
  - SO 2025 Developer Survey, AI section (45.7% distrust vs 32.7% trust), Dec 2025. HIGH. https://survey.stackoverflow.co/2025/ai
  - *SO conflict-of-interest context:* DevClass — "Dramatic drop in Stack Overflow questions" (Dec 2025 questions −78% YoY, via SO Data Explorer), **Jan 2026**. HIGH. https://devclass.com/2026/01/05/dramatic-drop-in-stack-overflow-questions-as-devs-look-elsewhere-for-help/ ; SO company announcement — ~28% layoffs, Oct 2023. HIGH. https://stackoverflow.blog/2023/10/16/stack-overflow-company-announcement-october-2023/
- Veracode — "Spring 2026 GenAI Code Security Update" (45% of AI code has a known vuln), **Mar 2026**. HIGH. https://www.veracode.com/blog/spring-2026-genai-code-security/
- GitGuardian — "State of Secrets Sprawl 2026" (28.65M new secrets +34% YoY; Claude-Code commits ~2× leak rate), **Mar 2026**. HIGH. https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/
- InfoWorld — "Claude Code leak puts enterprise trust at risk," **Apr 2026**. HIGH. https://www.infoworld.com/article/4154023/claude-code-leak-puts-enterprise-trust-at-risk-as-security-governance-concerns-mount.html
- METR — "Changing our Developer Productivity Experiment Design" (2026 follow-up; "unreliable signal"), **Feb 2026**. HIGH. https://metr.org/blog/2026-02-24-uplift-update/
- MIT Project NANDA — "State of AI in Business 2025" (95% of pilots no P&L impact), Jul 2025 (DATED anchor). HIGH. https://mlq.ai/media/quarterly_decks/v0.1_State_of_AI_in_Business_2025_Report.pdf
- Gartner — "Hype Cycle for Agentic AI" (17% deployed; Peak of Inflated Expectations), **Apr 2026**. MEDIUM. https://www.gartner.com/en/articles/hype-cycle-for-agentic-ai
- Gartner — ">40% of agentic AI projects canceled by 2027," Jun 2025 (trajectory anchor). HIGH. https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027
- Fortune — "Uber burned through its 2026 AI coding budget in four months," **May 2026**. HIGH. https://fortune.com/2026/05/26/uber-coo-ai-spending-tokens-claude-code/
- Fortune — "Microsoft reports are exposing AI's real cost problem," **May 2026**. HIGH/MEDIUM. https://fortune.com/2026/05/22/microsoft-ai-cost-problem-tokens-agents/
- OpenAI — "Why we no longer evaluate SWE-bench Verified" (≥59.4% flawed tests), **Feb 2026**. MEDIUM. https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/
- Anthropic Engineering — multi-agent system uses ~15× tokens, Jun 2025 (structural anchor). HIGH. https://www.anthropic.com/engineering/multi-agent-research-system

**Tailwinds** *(early/mid-2026 refresh)*
- Gartner — "Top 10 Strategic Technology Trends for 2026" (Multiagent Systems; 40% of apps by 2026), Oct 2025. MEDIUM. https://www.gartner.com/en/newsroom/press-releases/2025-10-20-gartner-identifies-the-top-strategic-technology-trends-for-2026
- McKinsey — "State of AI trust in 2026: Shifting to the agentic era" (23% scaling, 62% experimenting), **Apr 2026**. MEDIUM. https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/tech-forward/state-of-ai-trust-in-2026-shifting-to-the-agentic-era
- Tembo — "2026 Guide to Coding CLI Tools" (15 distinct CLI agents), **Feb 2026**. HIGH. https://www.tembo.io/blog/coding-cli-tools-comparison
- arXiv 2604.16529 — "Scaling Test-Time Compute for Agentic Coding" (70.9%→77.6% SWE-bench Verified), **Apr 2026**. HIGH. https://arxiv.org/abs/2604.16529
- arXiv 2602.01465 — "Agyn: A Multi-Agent System" (72.2% vs 65.0% single-agent), **Feb 2026**. HIGH. https://arxiv.org/html/2602.01465v2
- Claude Code docs — built-in git-worktree support / `isolation: worktree` for parallel subagents, 2026. HIGH. https://code.claude.com/docs/en/worktrees
- JetBrains Research — "Which AI Coding Tools Do Developers Actually Use at Work?" (90% / 74% / Claude Code 18%), **Apr 2026**. HIGH. https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/
- InfoQ — DORA ROI follow-up (~39% first-year ROI, ~8-mo payback), **May 2026**. HIGH. https://www.infoq.com/news/2026/05/dora-roi-ai-assisted-dev-report/
- The Next Web — Cursor/Anysphere ~$2B ARR, ~$50B valuation round, **Apr 2026**. MEDIUM. https://thenextweb.com/news/cursor-anysphere-2-billion-funding-50-billion-valuation-ai-coding
- TechFundingNews — Cognition $1B+ at ~$26B, ~$492M ARR, **May 2026**. MEDIUM. https://techfundingnews.com/cognition-ai-25b-valuation-funding-talks-devin-software-engineer/
- a16z — "Leaders, gainers, and unexpected winners in the enterprise AI arms race" (LLM spend +~65% in 2026), **Jan 2026**. HIGH. https://a16z.com/leaders-gainers-and-unexpected-winners-in-the-enterprise-ai-arms-race/
- Menlo Ventures — "2025: The State of Generative AI in the Enterprise" ($37B; coding $7.3B), Dec 2025. HIGH. https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/

**Competitors / funding**
- Conductor (YC S24). https://www.ycombinator.com/companies/conductor
- Crystal (Stravu, OSS). https://github.com/stravu/crystal
- Vibe Kanban shutdown (Bloop AI). https://www.vibekanban.com/blog/shutdown
- Claude Squad (OSS). https://github.com/smtg-ai/claude-squad
- uzi (OSS). https://github.com/devflowinc/uzi
- Sculptor / Imbue $200M Series B (2023). https://techcrunch.com/2023/09/07/imbue-raises-200m-to-build-ai-models-that-can-robustly-reason
- Cursor / Anysphere $900M @ $9.9B (Jun 2025). HIGH. https://techcrunch.com/2025/06/05/cursors-anysphere-nabs-9-9b-valuation-soars-past-500m-arr/
- Cognition/Devin $1B @ ~$25B (May 2026). MEDIUM. https://techcrunch.com/2026/05/27/ai-coding-startup-cognition-raises-1b-at-25b-pre-money-valuation/
- Replit $400M @ $9B (Mar 2026). MEDIUM. https://www.thesaasnews.com/news/replit-secures-400m-series-d-at-9b-valuation/
- Claude Code desktop redesign (parallel-agent, isolated worktrees, ~Apr 2026). MEDIUM. https://claude.com/blog/claude-code-desktop-redesign

**Explicit "not found" (stated, not fabricated):**
- No tier-1 market-size figure for **"AI developer tools"** as a standalone segment, nor for
  **"multi-agent / agent orchestration"** specifically — proxies used instead (§1.4).
- Could not confirm to a primary source: GitHub "46% of code written by Copilot," OpenAI Codex
  weekly-user counts, Claude Code user counts (only revenue is public), and several 2026
  valuations/funding specifics — treat as LOW where cited.
