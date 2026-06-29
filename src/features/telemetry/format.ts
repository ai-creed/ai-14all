export function formatTokens(n: number): string {
	// Degrade to 0 on undefined/NaN (e.g. transient worker/renderer version skew)
	// rather than rendering "NaN".
	if (!Number.isFinite(n)) return "0";
	// Render at "M" granularity from 100k up so token tallies read as e.g. 0.7M
	// rather than 700.0K; finer values fall back to K, then raw.
	if (n >= 100_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export type GaugeLevel = "ok" | "warn" | "hot";
export function gaugeColor(percent: number): GaugeLevel {
	if (percent >= 90) return "hot";
	if (percent >= 70) return "warn";
	return "ok";
}

// Notional dollars. Two decimals below $100, whole dollars above. Callers prefix
// "~" to signal "API-equivalent value", not a bill.
export function formatUsd(n: number): string {
	return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

// Relative countdown to a reset epoch (ms). "" when unknown, "now" when past.
export function formatReset(resetsAtMs: number | null, nowMs: number): string {
	if (resetsAtMs === null) return "";
	const diff = resetsAtMs - nowMs;
	if (diff <= 0) return "now";
	const days = Math.floor(diff / 86_400_000);
	if (days >= 1) return `${days}d`;
	const hours = Math.floor(diff / 3_600_000);
	const mins = Math.floor((diff % 3_600_000) / 60_000);
	return hours >= 1 ? `${hours}h${mins}m` : `${mins}m`;
}
