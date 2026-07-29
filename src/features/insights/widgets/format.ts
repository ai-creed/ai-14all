// Value formatters for the insights dashboard widgets. `fmt`/`fmtTok` are
// ported verbatim (same formulas) from the approved prototype
// (docs/design-specs/2026-07-28-insights-dashboard-prototype.html) — the
// prototype's mock token data was pre-scaled to millions, so `fmtTok` still
// expects a millions-denominated input; callers passing real billable token
// counts divide by 1_000_000 first. Costs are NOT derived from tokens here
// (the prototype's `fmtCost` faked a token-derived rate for the mockup) —
// real costUsd comes from CostSnapshot/WorkspaceRowVM, so `fmtCostUsd`
// formats that dollar amount directly, reusing the app's existing notional-
// USD formatter (src/features/telemetry/format.ts) rather than duplicating
// its under-$100/over-$100 rounding rule.
import { formatUsd } from "../../telemetry/format.js";

const HOUR_MS = 3_600_000;

// "6h 09m" / "42m" / "0m". `ms` is a duration in milliseconds.
export function fmt(ms: number): string {
	if (ms <= 0) return "0m";
	const h = Math.floor(ms / HOUR_MS);
	const m = Math.round((ms % HOUR_MS) / 60_000);
	return h > 0 ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m";
}

// "850M" / "1.20B". `millions` is a token count already expressed in
// millions (see module doc — real counts divide by 1_000_000 first).
export function fmtTok(millions: number): string {
	return millions >= 1000
		? (millions / 1000).toFixed(2) + "B"
		: Math.round(millions) + "M";
}

// Real billable token count -> the prototype's millions-scaled display.
export function fmtTokens(rawCount: number): string {
	return fmtTok(rawCount / 1_000_000);
}

// "≈ $2.30 est" / "—" (nothing priced in this scope).
export function fmtCostUsd(usd: number | null): string {
	return usd === null ? "—" : `≈ ${formatUsd(usd)} est`;
}
