#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const rootArg = process.argv.find((arg) => arg.startsWith("--root="));
const sinceArg = process.argv.find((arg) => arg.startsWith("--since="));
const root = rootArg
	? rootArg.slice("--root=".length)
	: path.join(os.homedir(), ".codex", "sessions");

const since = sinceArg
	? new Date(sinceArg.slice("--since=".length)).getTime()
	: 0;
const asJson = args.has("--json");
const asCsv = args.has("--csv");
const showEvents = args.has("--events");

function walk(dir) {
	if (!fs.existsSync(dir)) return [];

	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.isFile() && full.endsWith(".jsonl")) out.push(full);
	}
	return out.sort();
}

function readJsonl(file) {
	return fs
		.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line, index) => {
			try {
				return JSON.parse(line);
			} catch {
				return { __parseError: true, file, line: index + 1 };
			}
		});
}

function usageOf(info) {
	if (!info) return null;
	// Sum per-turn deltas only. If last_token_usage is absent, skip the event
	// (caller treats null as skip) — never fall back to total_token_usage, which
	// is cumulative within the session and would overcount when summed.
	return info.last_token_usage ?? null;
}

function emptyUsage() {
	return {
		input_tokens: 0,
		cached_input_tokens: 0,
		output_tokens: 0,
		reasoning_output_tokens: 0,
		total_tokens: 0,
	};
}

function addUsage(target, usage) {
	for (const key of Object.keys(target)) {
		target[key] += Number(usage?.[key] ?? 0);
	}
}

function sessionIdFromFile(file) {
	const base = path.basename(file, ".jsonl");
	return base.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "");
}

function dayOf(timestamp) {
	return new Date(timestamp).toISOString().slice(0, 10);
}

function fmtReset(epochSeconds) {
	if (!epochSeconds) return "";
	return new Date(epochSeconds * 1000).toISOString();
}

const events = [];
let latestLimit = null;

for (const file of walk(root)) {
	let model = "";
	let cwd = "";
	const sessionId = sessionIdFromFile(file);

	for (const record of readJsonl(file)) {
		if (!record || record.__parseError) continue;

		if (record.type === "turn_context") {
			model = record.payload?.model ?? model;
			cwd = record.payload?.cwd ?? cwd;
			continue;
		}

		if (record.type !== "event_msg") continue;
		const payload = record.payload;
		if (payload?.type !== "token_count") continue;

		const timestamp = record.timestamp;
		const ts = timestamp ? new Date(timestamp).getTime() : 0;
		if (since && ts < since) continue;

		if (payload.rate_limits) {
			latestLimit = {
				timestamp,
				session_id: sessionId,
				plan_type: payload.rate_limits.plan_type ?? "",
				limit_id: payload.rate_limits.limit_id ?? "",
				primary_used_percent: payload.rate_limits.primary?.used_percent ?? null,
				primary_window_minutes:
					payload.rate_limits.primary?.window_minutes ?? null,
				primary_resets_at: fmtReset(payload.rate_limits.primary?.resets_at),
				secondary_used_percent:
					payload.rate_limits.secondary?.used_percent ?? null,
				secondary_window_minutes:
					payload.rate_limits.secondary?.window_minutes ?? null,
				secondary_resets_at: fmtReset(payload.rate_limits.secondary?.resets_at),
				credits: payload.rate_limits.credits ?? null,
			};
		}

		const usage = usageOf(payload.info);
		if (!usage) continue;

		events.push({
			timestamp,
			day: dayOf(timestamp),
			session_id: sessionId,
			model,
			cwd,
			file,
			model_context_window: payload.info?.model_context_window ?? null,
			input_tokens: Number(usage.input_tokens ?? 0),
			cached_input_tokens: Number(usage.cached_input_tokens ?? 0),
			output_tokens: Number(usage.output_tokens ?? 0),
			reasoning_output_tokens: Number(usage.reasoning_output_tokens ?? 0),
			total_tokens: Number(usage.total_tokens ?? 0),
		});
	}
}

const daily = new Map();
const byModel = new Map();

for (const event of events) {
	const d = daily.get(event.day) ?? emptyUsage();
	addUsage(d, event);
	daily.set(event.day, d);

	const model = event.model || "(unknown)";
	const m = byModel.get(model) ?? emptyUsage();
	addUsage(m, event);
	byModel.set(model, m);
}

function rowsFromMap(map, keyName) {
	return [...map.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, usage]) => ({ [keyName]: key, ...usage }));
}

function printTable(title, rows, keyName) {
	console.log(`\n${title}`);
	console.log("-".repeat(title.length));
	if (!rows.length) {
		console.log("(no token_count usage events found)");
		return;
	}

	const headers = [
		keyName,
		"input_tokens",
		"cached_input_tokens",
		"output_tokens",
		"reasoning_output_tokens",
		"total_tokens",
	];

	const widths = Object.fromEntries(headers.map((h) => [h, h.length]));
	for (const row of rows) {
		for (const h of headers)
			widths[h] = Math.max(widths[h], String(row[h]).length);
	}

	console.log(headers.map((h) => String(h).padStart(widths[h])).join("  "));
	for (const row of rows) {
		console.log(
			headers.map((h) => String(row[h]).padStart(widths[h])).join("  "),
		);
	}
}

function toCsv(rows) {
	if (!rows.length) return "";
	const headers = Object.keys(rows[0]);
	const esc = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
	return [
		headers.join(","),
		...rows.map((row) => headers.map((h) => esc(row[h])).join(",")),
	].join("\n");
}

const output = {
	root,
	event_count: events.length,
	latest_limit: latestLimit,
	daily: rowsFromMap(daily, "day"),
	by_model: rowsFromMap(byModel, "model"),
	events: showEvents ? events : undefined,
};

if (asJson) {
	console.log(JSON.stringify(output, null, 2));
} else if (asCsv) {
	console.log(toCsv(showEvents ? events : output.daily));
} else {
	printTable("Daily Token Usage", output.daily, "day");
	printTable("Token Usage By Model", output.by_model, "model");

	console.log("\nLatest Codex Limit Status");
	console.log("-------------------------");
	console.log(
		latestLimit
			? JSON.stringify(latestLimit, null, 2)
			: "(no rate limit snapshot found)",
	);
}
