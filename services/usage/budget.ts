// Billable-token budgets (input + output + cache_creation, excluding cache
// reads), reverse-engineered from real max-5x usage: at 16% of the 5h limit we
// measured ~0.79M billable (→ ~5M cap) and at 7% of the weekly limit ~7.9M
// billable (→ ~112M cap). Scaled ~4x for max-20x. All tunable via settings (⚙).
// Max 5x is "5x Pro", so Pro ≈ max-5x / 5; max-20x ≈ 4x max-5x. The Pro tier
// string is a best guess until a real Pro `rateLimitTier` is observed.
const FIVE_H_BY_TIER: Record<string, number> = {
	default_claude_pro: 1_000_000,
	default_claude_max_5x: 5_000_000,
	default_claude_max_20x: 20_000_000,
};
const WEEKLY_BY_TIER: Record<string, number> = {
	default_claude_pro: 22_400_000,
	default_claude_max_5x: 112_000_000,
	default_claude_max_20x: 448_000_000,
};
const DEFAULT_FIVE_H = 5_000_000;
const DEFAULT_WEEKLY = 112_000_000;

export function seedWeeklyBudget(tier: string | undefined): number {
	return (tier && WEEKLY_BY_TIER[tier]) || DEFAULT_WEEKLY;
}

export function seedFiveHourBudget(tier: string | undefined): number {
	return (tier && FIVE_H_BY_TIER[tier]) || DEFAULT_FIVE_H;
}

export function budgetPercent(used: number, budget: number): number {
	if (!budget || budget <= 0) return 0;
	return Math.min(100, Math.round((used / budget) * 100));
}

// Most recent {day} at {hour}:00 local time at or before nowMs. day: 0=Sun..6=Sat.
// This is the start of the current weekly limit window (Claude resets weekly at
// a fixed wall-clock; default Mon 07:00). The window is fixed, not rolling.
export function weeklyAnchorMs(
	nowMs: number,
	day: number,
	hour: number,
): number {
	const d = new Date(nowMs);
	d.setHours(hour, 0, 0, 0);
	while (d.getDay() !== day || d.getTime() > nowMs) {
		d.setDate(d.getDate() - 1);
	}
	return d.getTime();
}
