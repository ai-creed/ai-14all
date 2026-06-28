import { join } from "node:path";
import type { LimitGauge } from "../../../shared/models/usage.js";
import {
	CODEX_MARKER,
	CODEX_META_MARKER,
	CODEX_TURN_MARKER,
	parseCodexRateLimits,
	parseCodexSessionMeta,
	parseCodexTokenLine,
	parseCodexTurnContext,
	sessionIdFromCodexFile,
} from "../codex-source.js";
import { readNewLines } from "../incremental-reader.js";
import type { GaugeContext, ParseCtx, TelemetryDriver } from "./types.js";

export const codexDriver: TelemetryDriver = {
	id: "codex",
	capabilities: {
		tokenLog: true,
		storeKind: "jsonl-tree",
		timeSource: "per-event",
		cwdSource: "in-line",
		nativeLimits: true,
	},
	roots: (home) => [join(home, ".codex", "sessions")],
	keep: (line) =>
		line.includes(CODEX_MARKER) ||
		line.includes(CODEX_META_MARKER) ||
		line.includes(CODEX_TURN_MARKER),
	seedCtx: (file) => ({
		sessionId: sessionIdFromCodexFile(file.split("/").pop() ?? ""),
		cwd: "",
		model: "",
	}),
	// Re-derive cwd/model from a meta-only re-scan when resuming past byte 0
	// without persisted ctx. Bounded to the ALREADY-PROCESSED prefix [0, upToOffset)
	// — never the newly appended bytes we are about to ingest — so a context line
	// appended after the offset cannot retroactively misattribute earlier tokens.
	// Token lines are excluded by the meta-only filter, so nothing is re-ingested.
	recoverCtx: (file, upToOffset) => {
		const ctx: ParseCtx = {};
		const metaOnly = (l: string): boolean =>
			l.includes(CODEX_META_MARKER) || l.includes(CODEX_TURN_MARKER);
		for (const line of readNewLines(file, 0, metaOnly, upToOffset).lines) {
			const meta = parseCodexSessionMeta(line);
			if (meta) {
				ctx.cwd = meta.cwd;
				continue;
			}
			const tc = parseCodexTurnContext(line);
			if (tc) {
				if (tc.cwd) ctx.cwd = tc.cwd;
				if (tc.model) ctx.model = tc.model;
			}
		}
		return ctx;
	},
	parseLine: (line, ctx) => {
		const meta = parseCodexSessionMeta(line);
		if (meta) {
			ctx.cwd = meta.cwd;
			return {};
		}
		const tc = parseCodexTurnContext(line);
		if (tc) {
			if (tc.cwd) ctx.cwd = tc.cwd;
			if (tc.model) ctx.model = tc.model;
			return {};
		}
		if (!line.includes(CODEX_MARKER)) return {};
		const limits = parseCodexRateLimits(line) ?? undefined;
		const event =
			parseCodexTokenLine(line, {
				cwd: ctx.cwd ?? "",
				sessionId: ctx.sessionId ?? "",
				model: ctx.model ?? "",
			}) ?? undefined;
		return { event, limits };
	},
	buildGauge: (gctx: GaugeContext): LimitGauge => {
		const rl = gctx.providerLimits;
		return {
			provider: "codex",
			real: true, // dropped in the cleanup task along with LimitGauge.real
			fiveHour: {
				percent: rl?.primary?.usedPercent ?? 0,
				resetsAtMs: rl?.primary?.resetsAtMs ?? null,
			},
			weekly: {
				percent: rl?.secondary?.usedPercent ?? 0,
				resetsAtMs: rl?.secondary?.resetsAtMs ?? null,
				used: null,
				budget: null,
			},
		};
	},
};
