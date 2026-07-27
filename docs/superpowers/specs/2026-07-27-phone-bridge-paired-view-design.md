# ai-14all — Phone Bridge paired-view polish (capability ledger + relay disclosure)

**Status:** design proposed. **Owner:** Vu Phan. **Repo:** ai-14all. **Branch:** `master`.
**Predecessor:** `docs/superpowers/specs/2026-07-15-phone-bridge-dialog-redesign-design.md` (§5 layout, still normative for the non-paired views).
**Validated mockup:** `~/.ai-pref-nsync/local-docs/ai-14all/brainstorm/2026-07-27-phone-bridge-A-final.html` (option A of three; options record alongside it as `…-phone-bridge-paired-options.html`). Checked in all four themes — `dark` / `light` / `warm` / `tui`.

## 1. Context & goal

The paired view shipped by the 2026-07-15 slice works, but three of its parts were added or left without a design pass, and the result reads as unfinished. This slice reworks two things:

- **The paired view** — device card, permissions display, unpair affordance.
- **The relay control** — which is **bridge-scoped, not device-scoped**. `PhoneBridgePanel.tsx:174` renders it for every enabled view (`view !== "off" && view !== "loading"`), so it is on screen in `idle`, `scan`, `sas`, `paired` and `fault` alike. Restyling it as a disclosure is therefore visible in all five, and the existing relay E2E drives it while `view-idle` is asserted visible (`tests/e2e/phone-bridge.test.ts:531,539`).

The *state machine* and every non-paired view's own content (QR, SAS digits, fault box, pair CTA) are untouched, as is all main-process behaviour.

Goal: the dialog answers "what is this phone allowed to do, and what can I change about that?" in one glance, with no contradictory statements.

## 2. Problems in the current implementation

1. **The relay block is unstyled.** `PhoneBridgePanel.tsx:174-192` wraps it in a classless `<div>`, and `<span>Relay: {status?.relay}</span>` (line 190) carries no class — so it renders at the inherited 1rem while every neighbouring hint is 0.75rem. It is the only unstyled region in the panel and the first thing the eye catches. The relay row does not appear in the 2026-07-15 spec's §5 layout at all; it was added afterwards.
2. **The permissions text and the terminal-input toggle can contradict each other.** `permissionsLabel(status.grantedPermissions)` (line 310) and `settings.phoneBridge.ptyInputEnabled` (line 333) are independent gates rendered in the same card. Turn the toggle off and the line above it still reads "can type into terminals".
3. **The read-only case offers a control that cannot work.** For a pre-2b.2 record (`grantsForStoredDevice` falls back to session-reports only, `xbp-grants.ts:25`) the card still renders an armed "Terminal input" switch, even though `xbp-pty-input-executor.ts:69` will refuse every keystroke.
4. **A second real kill switch has no UI.** `phoneBridge.pushWakeEnabled` (`persisted-settings.ts:41`) is enforced at `xbp-push-token-handlers.ts:28`, but is unreachable from any surface. Showing one of the two switches and not the other is arbitrary.
5. **The permissions summary is a run-on string** that wraps to two lines and cannot express per-capability state.
6. **"Phone paired" / "Paired just now"** states the same fact twice; line one is a label, not a name.
7. **Destructive action shouts at rest.** `Unpair` renders with a permanent `--destructive` border, pulling the eye harder than the card's content, before any intent is expressed.
8. **Jargon copy.** "Off = disarm without unpairing" is an equation, not a sentence.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Permissions become a **capability ledger**: one row per capability, inside the device card. | One row = one truth; problems 2, 3, 5 become structurally impossible. |
| D2 | **Reading rule: a bare `✓` states a fact, `[brackets]` mark a control.** | Learnable in one glance; distinguishes an immutable grant from a live switch without a legend. Mono brackets are TUI-native (memory `mem-2026-07-02…`, `docs/tui-css-spec.md`). |
| D3 | **Four rows, two controls** (user decision, 2026-07-27): read session reports, act on workflows, send notifications `[✓]`, type into terminals `[✓]`. | Surfaces both real kill switches. `control:inspect` is omitted — it is minted at pairing but has no user-facing meaning and nothing to act on. |
| D4 | The **liveness line is dropped** (user decision, 2026-07-27). Header reads `Phone`. | Keeps the slice presentation-only. Remains a deferred non-goal (2026-07-15 spec §10). |
| D5 | **Relay becomes a disclosure** at the bottom of the panel, whose summary line reports its own state (`Off-network relay · off`). It stays **bridge-scoped** — rendered in exactly the views it is rendered in today, not moved inside the paired card. | Set-once and empty for most users; it should not outrank the paired device. Fixes problem 1 by giving it a designed home without narrowing where it is reachable. |
| D5a | The disclosure **starts open when a relay URL is persisted**, collapsed when it is empty. Implemented as a **ref-latched state seed** that fires once on the first resolved settings load — never a prop derived from `relayBaseUrl`, which would reopen a user-closed disclosure on the next status re-render (§5, §8). | Never hide configuration the user has already made; an empty field is the only case worth collapsing. A user's later toggle must survive the status changes this panel receives continuously. Also keeps the configured-relay E2E assertions reachable without an extra open step. |
| D6 | **Unpair is neutral at rest**, destructive on hover/focus, and the existing two-step confirm is kept. | The confirm step already does the safety work. |
| D7 | The renderer keeps **hardcoded permission strings** (`"control:act"` etc.), as `permissionsLabel` does today. | No `src/` module imports `@ai-creed/command-contract`; this slice does not open that door. Risk noted in §9. |
| D8 | The terminal-input control's accessible name comes from its **visible label** ("Type into terminals"), replacing today's `aria-label="Allow phone terminal input"`. | WCAG 2.5.3 label-in-name. Costs two test-locator updates (§8). |

## 4. Design — capability model

`src/components/settings/phone-bridge-format.ts` gains a structured builder and drops the string formatter.

```ts
export type CapabilityRow = {
	key: "reports" | "act" | "notify" | "pty";
	label: string;
	hint?: string;
	granted: boolean;          // from status.grantedPermissions
	// State of this capability's local kill switch. null = the row has NO
	// control — either no switch exists for it, or the grant is absent so the
	// switch is moot. `armed !== null` iff the row renders a control.
	armed: boolean | null;
};

export function capabilityRows(
	perms: string[] | null,
	flags: { pushWakeEnabled: boolean; ptyInputEnabled: boolean },
): CapabilityRow[];
```

Rules:

- `granted` for `reports` is always `true` (every record carries session reports, `xbp-grants.ts:26`).
- `act` → `perms` includes `"control:act"`; `notify` → `"control:notify"`; `pty` → `"control:pty-write"`.
- `perms == null` or empty → fail-closed: only `reports` granted. Mirrors `grantsForStoredDevice`.
- **`armed` is `null` whenever `granted` is `false`** — for every key, regardless of the flags passed. An absent grant means there is nothing to arm, and the executor refuses the call anyway (`xbp-pty-input-executor.ts:69`, `xbp-push-token-handlers.ts:28`). This is what removes problem 3.
- `armed` is also `null` for `reports` and `act` in all cases — no local switch exists for either.
- Otherwise (`granted: true`, key is `notify` or `pty`) `armed` is the corresponding settings flag: `notify` ← `pushWakeEnabled`, `pty` ← `ptyInputEnabled`.

Stated as one rule, which is the form the tests assert against:

```
armed = (granted && key ∈ {notify, pty}) ? flagFor(key) : null
```

The invariant this buys: **`armed !== null` iff the row renders a control**, so the panel needs no second condition and cannot drift from the model. A `granted: false` row and a `granted: true, armed: false` row are still distinguishable — the first is "not granted", the second is a disarmed switch.

`permissionsLabel` is deleted once the panel stops calling it (its only caller, `PhoneBridgePanel.tsx:311`).

## 5. Design — panel markup

```
Phone Bridge
Connect a phone to monitor live agent sessions over your local network.
──────────────────────────────────────────────────
● Listening on 192.168.1.51:52329          [ on ]   ← unchanged status strip
──────────────────────────────────────────────────
PAIRED DEVICE
┌────────────────────────────────────────────────┐
│ ▐▌  Phone                          Unpair      │  ← neutral at rest
│     Paired just now                            │
├────────────────────────────────────────────────┤
│  ✓   Read session reports                      │
│  ✓   Act on workflows                          │
│ [✓]  Send notifications to this phone          │
│      Pings the phone when a workflow finishes  │
│      or needs you.                             │
│ [✓]  Type into terminals                       │
│      Sends keystrokes to running agents.       │
├────────────────────────────────────────────────┤
│ The phone will have to pair again.             │  ← confirm expands here,
│              [ Confirm unpair ]  [ Cancel ]    │    Unpair withdraws
└────────────────────────────────────────────────┘
▸ Off-network relay · off
──────────────────────────────────────────────────
[ Close ]
```

Legacy (pre-2b.2) record:

```
│  ✓   Read session reports                      │
│  ·   Act on workflows              not granted │
│  ·   Send notifications…           not granted │
│  ·   Type into terminals           not granted │
│      Pair this phone again to grant the newer  │
│      capabilities.                             │
```

Element contract:

- **`row.armed === null` selects the element**: those rows render `<p class="phone-bridge__cap">`, the rest render `<button class="phone-bridge__cap" role="switch" aria-checked={row.armed}>`. Same class, so the mark and name columns align exactly. Per §4 this single condition already covers both fact rows and denied rows — the panel must not re-test `granted` to decide whether to render a control, or the two conditions can drift apart.
- A denied row (`granted: false`) renders the `·` mark plus the `not granted` suffix; a disarmed row (`granted: true, armed: false`) renders `[ ]`. The mark distinguishes them, so "off by choice" never reads as "unavailable".
- The hint is a **sibling** `<p class="phone-bridge__cap-hint">` linked by `aria-describedby`, not a child of the button — keeping it out of the button's accessible name.
- Toggling a control row calls `update({ phoneBridge: { pushWakeEnabled | ptyInputEnabled: next } })` — the same `useSettings().update` path the current switch uses. No new IPC, no contract change.
- Relay is a native `<details>` that **keeps its current render condition** (`view !== "off" && view !== "loading"`) — the diagram above shows it in the paired view, but it sits below the view slot and appears in `idle` / `scan` / `sas` / `fault` identically. The field commits `onBlur` exactly as today (`commitRelayDraft`), and gains a `wss://relay.example.com` placeholder. Its wrapper and status line get real classes, closing problem 1.
- Per D5a the `<details>` open state is seeded once from the loaded `relayBaseUrl` (open when non-empty). The status value moves from the classless `<span>Relay: {status.relay}</span>` into the `<summary>` as `Off-network relay · {status.relay}`.
- **D5a is a state latch, not a derived prop.** `relayBaseUrl` arrives asynchronously (`settings.read()` in an effect), so the seed cannot be a `useState` initializer; it needs a ref latch that fires on the first resolved load only:

  ```ts
  const [relayOpen, setRelayOpen] = useState(false);
  const relaySeeded = useRef(false);
  // inside the existing settings.read().then(...) handler:
  if (!relaySeeded.current) {
      relaySeeded.current = true;
      setRelayOpen(settings.phoneBridge.relayBaseUrl !== "");
  }
  ```

  rendered as `<details open={relayOpen} onToggle={(e) => setRelayOpen(e.currentTarget.open)}>`.

  **Anti-pattern — `open={relayBaseUrl !== ""}`.** React writes `open` only when the prop **value changes** — react-dom calls `setProp` under `nextProp !== lastProp` (`react-dom-client.development.js:21122-21128`), and `<details>` has no controlled-restore path. So a derived prop survives a same-value re-render, and the two states it *does* break are:

  - **Remount.** The relay block's render condition is `view !== "off" && view !== "loading"`, so toggling the bridge off/on — or closing and reopening the dialog — unmounts and remounts the `<details>`, and the derived prop reopens a disclosure the user had collapsed.
  - **Draft flip.** The user opens the disclosure with no URL, types one, then clears it; the derived value goes `true → false`, React writes the removal, and the panel snaps shut mid-edit.

  (An earlier draft of this spec claimed React rewrites `open` on *every* render and that a status-change re-render alone would reopen it. That is false, and it was caught only because a reviewer mutated the component and found the regression tests still green. The conclusion is unchanged — use the latch — but §8's regression tests must target remount and draft-flip, which are the paths that actually fail.)
  Clearing the field to `""` must **not** re-close the disclosure — the latch has already fired, and yanking the panel shut mid-edit would be worse than leaving it open.

## 6. Design — CSS (`src/styles/modules/dialogs.css`)

New `phone-bridge__caps` / `__cap` / `__cap-mark` / `__cap-name` / `__cap-hint` / `__cap-deny` rules, plus `__relay` disclosure rules and a `__btn--quiet-danger` variant. TUI trait set is mandatory, as for the rest of the block: radius 0, flat surfaces, solid separators, `var(--font-ui)`.

Three details worth calling out:

- **The transparent border goes on the base `.phone-bridge__cap` rule**, not only on the button variant, so fact rows and control rows align to the pixel. Under tui `--shell-border-width` is 2px, where a one-sided border would visibly stagger the column.
- The mark column is `width: 3ch; text-align: center` so `✓`, `[✓]`, `[ ]` and `·` all share one column.
- **`__btn--quiet-danger` states are explicit (D6).** At rest it inherits `.phone-bridge__btn` exactly — `--panel-border` border, `--text-secondary` text, no destructive colour anywhere. `:hover` **and** `:focus-visible` both switch border and text to `--danger` on a transparent background; the two selectors share one rule so they cannot diverge. The filled `--danger` background stays reserved for `Confirm unpair`, keeping the escalation legible: quiet → outlined danger → filled danger. §8 guards the rest and hover states with baselines and the focus state per its route 1/2.

Removed as dead: `.phone-bridge__device-toggle`, `__device-toggle-label`.

Also in this slice: `.phone-bridge__view { min-height: 150px }` (line 265) is raised to the tallest **resting** view. It is already shorter than the 168px QR, and the 4-row ledger makes the paired view taller still, so the dialog visibly resizes when moving between states.

The value must be **measured, not estimated** — `tui` is the driver on every view, because it alone sets `line-height: 1.4` and `--shell-border-width: 2px` (`tokens.css:319,332`), and the ledger multiplies both across four bordered rows plus two hints. Measured natural heights at 560px:

| view | dark / light / warm | tui |
|---|---|---|
| idle | 71 | 80.98 |
| scan | 205 | 207.39 |
| sas | 135 | 154.58 |
| paired (legacy) | 214 | 241.38 |
| **paired (full grants)** | 232 | **262.17** |
| fault | 76 | 86.39 |

→ `min-height: 264px`. The paired view with the unpair confirm expanded (273 / 308.97) is **excluded on purpose**: that growth is user-initiated, and sizing every other view to it would leave ~180px of dead space under `idle`. The requirement is no resize *between states*, not a fixed height through a disclosure the user opened.

A pixel baseline can only prove the rule exists, never that its value is large enough, so §8 additionally requires a per-palette idle-vs-paired height equality assertion.

## 7. Copy

| Where | Now | Proposed |
|---|---|---|
| Device name | `Phone paired` | `Phone` |
| Capability 1 | `session reports` | `Read session reports` |
| Capability 2 | `can act on workflows` | `Act on workflows` |
| Capability 3 | — | `Send notifications to this phone` / hint: `Pings the phone when a workflow finishes or needs you.` |
| Capability 4 | `can type into terminals` | `Type into terminals` / hint: `Sends keystrokes to running agents.` |
| Toggle hint | `Phone may type into live agent terminals. Off = disarm without unpairing.` | folded into the capability hint above |
| Denied row | — | `not granted` + `Pair this phone again to grant the newer capabilities.` |
| Relay summary | `Relay: off` | `Off-network relay · off` |
| Relay hint | — | `Lets a phone reach this Mac when it is not on your Wi-Fi. Leave empty for local network only.` |
| Unpair confirm | `The phone will have to re-pair.` | `The phone will have to pair again.` |

Capability-3 copy is grounded in `push-wake-detector.ts:6` — the trigger set is workflow `done` / `halted` plus escalation.

## 8. Testing (TDD per task)

- **`phone-bridge-format.test.ts`** — rewrite `permissionsLabel` cases as `capabilityRows`:
  - full grants → exactly four rows in order `reports, act, notify, pty`; `armed` is `null, null, boolean, boolean`.
  - **Asymmetric wiring regression (required).** With **full grants**, assert `{ pushWakeEnabled: false, ptyInputEnabled: true }` yields `notify.armed === false` **and** `pty.armed === true`, and the inverse input yields the exact mirror. A single symmetric case passes even if both rows are wired to the same flag; these two cases are what make the crossed-wire bug detectable. Assert per-row `armed` values explicitly — never a count of non-null entries.
  - `null` perms **with both flags `true`** → fail-closed: `reports` granted, the other three `granted: false`, and all four `armed: null`. This is the case that pins §4's grant-gate; without the flags set to `true` it passes vacuously against a model that ignores `granted`.
  - `["control:act"]` **with both flags `true`** → act granted (`armed: null`, no switch exists), notify/pty `granted: false, armed: null`.
  - granted-but-disarmed → `granted: true, armed: false`, and denied → `granted: false, armed: null`. Assert the two are distinguishable, since both render as "not on".
  - **Invariant sweep.** Over every case in this suite, assert `row.armed !== null` implies `row.granted === true` — the property §5's element contract depends on.
- **`PhoneBridgePanel.test.tsx`** — paired view renders four capability rows; denied rows render no `role="switch"`; toggling "Type into terminals" calls `update` with `ptyInputEnabled` **only**, and "Send notifications to this phone" with `pushWakeEnabled` **only** (assert the patch key, so a crossed wire fails here too). Relay: summary reports `status.relay`, is collapsed when `relayBaseUrl` is empty and open when it is set (D5a). Existing switch locators updated per D8.
  - **D5a regressions (required, and each one must be mutation-verified).** A test here only earns its place if it FAILS against `open={relayBaseUrl !== ""}` with `onToggle` removed. Verify that by actually making the mutation and running the test — a plain status-change re-render does **not** fail against the anti-pattern (see §5), so an assertion built on that alone is vacuous. The two paths that do fail:
    - **Remount:** mount with a persisted `relayBaseUrl` (disclosure opens), close it, push `enabled: false` through `onStatusChanged` so the view goes `off` and the block unmounts, push an enabled status back, and assert the disclosure is **still closed**.
    - **Draft flip:** mount with an empty `relayBaseUrl` (collapsed), open it, type a URL into the field, then clear the field — the derived value would flip `true → false` — and assert it stays **open**.
  - The `relaySeeded` ref guard has no failing test of its own, because `settings.read()` lives in a `[]`-dep effect and resolves once per mount. It is still required: `src/main.tsx:38` wraps the app in `StrictMode`, whose double-invoked effects issue a second `read()`. Document that at the guard rather than pretending a test covers it.
- **`phone-bridge.test.ts` (e2e)** — two separate ripples:
  - *Paired card:* assertions at lines 310-313 and 357 move from the permissions string to capability rows; the pty-input disarm test's switch locator updated per D8. Its refusal assertion is unchanged — the settings path it drives is the same.
  - *Relay flow (`tests/e2e/phone-bridge.test.ts:520-566`) — this is the flow D5 puts at risk.* It drives `#phone-bridge-relay-url` five times while `view-idle` is visible. Every interaction must first ensure the `<details>` is open. Add an **idempotent** helper — `openRelay()` clicks the `<summary>` only when the element does not already have the `open` attribute — and call it before each field interaction. It must not be a blind click: after D5a a relaunch with a persisted URL arrives already open, and a blind click would collapse it and break the very assertion that follows. The `statusLine()` locator `/^Relay: (off|registered|retrying)$/` **no longer matches** and must be re-pointed at the `<summary>` as `/^Off-network relay · (off|registered|retrying)$/`. Add two assertions the current suite cannot make: the disclosure is **collapsed on first boot** (empty relay) and **open after relaunch** with a persisted URL (D5a). The off/registered/retrying state transitions themselves are unchanged.
- **`css-refactor.visual.spec.ts` (four-theme guard, required by §6/§10).** Add a phone-bridge block to `src/app/UiGallery.tsx` under `data-testid="gallery-phone-bridge"`, then add an element-scoped palette loop over `dark | light | warm | tui`. This follows the existing `sidebar-${palette}.png` pattern in the same file (line ~210) rather than inventing infrastructure.

  **Fixture variants** — every one of these is a state some rule in §6 is the only thing styling, so a deleted rule must fail a baseline:

  | `data-testid` | State | Guards |
  |---|---|---|
  | `gallery-pb-ledger-full` | Paired, all grants, both controls armed | mark-column alignment between `<p>` fact rows and `<button>` control rows (the transparent-border detail), `[✓]` on `--primary` |
  | `gallery-pb-ledger-legacy` | Legacy record — one granted, three denied | `·` mark, `not granted` suffix, muted treatment |
  | `gallery-pb-ledger-disarmed` | Granted, both controls off | `[ ]` distinct from the denied `·` — the §5 distinction has no other guard |
  | `gallery-pb-relay-collapsed` | `<details>` closed | `▸` marker, summary type scale, separator |
  | `gallery-pb-relay-open` | `<details open>` with a persisted URL | disclosure body padding, `▾` marker, input surface |
  | `gallery-pb-view-paired` | A real `.phone-bridge__view` wrapping the full-grant ledger | one end of the min-height check |
  | `gallery-pb-view-idle` | A real `.phone-bridge__view` holding the shortest view's content (`idle`) | the other end — **required**: no other fixture carries that class, so without these two nothing can see the rule deleted or undersized |

  **Height assertion (not a baseline).** Per palette, measure both view boxes and assert `|paired − idle| < 1` plus `idle > 200`. When min-height is large enough both are pinned to it and the heights are equal; when it is deleted they collapse to content, and when it is merely *undersized* the paired view outgrows idle in `tui` alone. A screenshot cannot express this — it only proves the box is *some* height, which an undersized value satisfies.

  **Captures per palette:**

  1. `phone-bridge-${palette}.png` — the whole block at rest, covering all six variants including the raised `__view` min-height.
  2. `phone-bridge-unpair-hover-${palette}.png` — after `await unpair.hover()`, scoped to the device card. **Required**: without it, deleting D6's hover rule passes every other test in this spec.

  **D6 focus state.** `:focus-visible` does **not** match a programmatic `element.focus()` in Chromium when the preceding interaction was a pointer event, so a `.focus()`-then-screenshot test would silently assert the resting appearance and prove nothing. Two acceptable routes, in preference order:

  1. Reach the button by **keyboard** (`page.keyboard.press("Tab")` from a known preceding gallery control, asserting `:focus` landed on Unpair first) and capture `phone-bridge-unpair-focus-${palette}.png`.
  2. If keyboard traversal proves brittle in the Electron harness, drop the pixel baseline and assert **computed style** instead. D6 changes **two** properties, so the assertion must cover both or it does not test D6:
     - `border-color` resolves to the palette's `--danger` token, **and** differs from resting `border-color`;
     - `color` resolves to the palette's `--danger` token, **and** differs from resting `color`.

     Asserting the border alone passes a focus rule that colours the border but leaves the text at `--text-secondary` — exactly the half-applied state D6 forbids. Read both properties from the same `getComputedStyle` call at focus and at rest, and compare against `--danger` resolved from the same element, so the check stays theme-parameterized rather than hardcoding four palettes' hex values. **"From the same element" is load-bearing:** `getPropertyValue("--danger")` returns the declared indirection (`var(--destructive)` in `:root`), so resolve it with a probe appended *inside the Unpair button* — custom properties inherit, so a child sees the exact value applying there. Resolving at `document.body` instead would miss an override scoped to the button or any ancestor between it and `<body>`.

  Route 2 is the required floor — do not ship the focus state with no coverage at all. Whichever route is taken, the same two-property expectation applies: route 1's pixel baseline captures it implicitly, route 2 must state it explicitly.
- **Typecheck** catches the `permissionsLabel` deletion ripple.

## 9. Risks / notes

- **D7 hardcoded strings.** If `NEW_PAIRING_GRANTS` ever changes a permission string, the ledger silently shows "not granted". Today's `permissionsLabel` has the identical exposure, so this slice does not make it worse — but importing the contract constants into the renderer would close it, and is worth its own decision.
- **`control:inspect` stays invisible** (D3). If it later gains user-facing meaning it needs a row.
- **Scope containment.** No main-process, IPC, or contract changes: `pushWakeEnabled` and `ptyInputEnabled` both already exist in `PhoneBridgeSettingsPatch` (`persisted-settings.ts:102-103`) and both already have enforcement sites.
- **The relay disclosure is the riskiest change in the slice**, and the only one whose blast radius reaches non-paired views. It breaks the existing relay E2E in two independent ways — a hidden input (five interactions) and a dead `statusLine()` regex — neither of which is a rendering bug. Task 3 is sized around that ripple; if the relay rework has to be dropped for time, tasks 1, 2, 4 and 5 still land and the relay block simply keeps its current (unstyled) markup.
- **Visual baselines are a maintenance cost.** Eight to twelve new PNG baselines join the existing `css-refactor.visual` set — four palettes × (block at rest + Unpair hover, plus Unpair focus if §8 route 1 is taken) — and must be regenerated on any intended change to the ledger, the relay disclosure, or the Unpair styling. That is the accepted price of the §6/§10 four-theme requirement; without them, "verify in all four themes" is a manual claim no CI run can check. Consolidating the five fixture variants into **one** block-level capture per palette keeps that count down: they are static markup with no interaction between them, so separate baselines would multiply maintenance without adding coverage. The hover and focus captures are separate only because they cannot be expressed in the same static shot.

## 10. Task decomposition (each independently green)

1. **Capability model** — add `capabilityRows` to `phone-bridge-format.ts` beside the existing `permissionsLabel` (+ tests, including both asymmetric cases). 1 impl file.
2. **Ledger** — switch the paired view to the capability ledger, quiet the Unpair button, delete `permissionsLabel` (+ panel test and the paired-card e2e assertions). 1 impl file.
3. **Relay disclosure** — `<details>` wrapper, D5a seeded open state, summary status line, placeholder (+ panel test and the relay e2e flow rework: `openRelay()` helper, re-pointed `statusLine()`, collapsed/open assertions). 1 impl file. **Split from task 2 deliberately** — it is the only part of the slice that changes what non-paired views render, and it carries the whole relay-e2e ripple.
4. **CSS** — `phone-bridge__caps` / `__cap*` / `__relay` / `__btn--quiet-danger` rules, remove the dead toggle rules, raise `__view` min-height. 1 impl file.
5. **Four-theme guard** — five-variant gallery block in `UiGallery.tsx` (ledger full / legacy / disarmed, relay collapsed / open) + palette-looped element screenshots and the Unpair hover and focus captures in `css-refactor.visual.spec.ts`; record baselines with `pnpm test:e2e css-refactor.visual --update-snapshots`. 2 impl files.

Tasks 2 and 3 both touch `PhoneBridgePanel.tsx`; run them in order, not in parallel.

## 11. Non-goals

- Live "phone connected" indicator (D4 — deferred, carried over from 2026-07-15 §10).
- Device naming — the XBP protocol carries none.
- Multi-device pairing.
- Any change to pairing, SAS, fault views, or crypto semantics.
