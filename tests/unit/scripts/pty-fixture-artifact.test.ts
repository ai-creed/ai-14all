// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PtyFixtureArtifactSchema } from "../../../scripts/pty-fixture-schema.js";

describe("committed pty fixture artifact (reflow spec §4)", () => {
	it("tests/fixtures/pty-real-session.json validates against the artifact schema", () => {
		const artifact = JSON.parse(
			readFileSync("tests/fixtures/pty-real-session.json", "utf8"),
		) as unknown;
		const parsed = PtyFixtureArtifactSchema.safeParse(artifact);
		expect(parsed.success, JSON.stringify(parsed)).toBe(true);
	});

	it("the artifact carries wrapped flags (it exercises reflow, not just short lines)", () => {
		const artifact = JSON.parse(
			readFileSync("tests/fixtures/pty-real-session.json", "utf8"),
		) as {
			pages: Array<{ rows: Array<{ wrapped?: boolean }> }>;
		};
		const rows = artifact.pages.flatMap((p) => p.rows);
		expect(rows.some((r) => r.wrapped === true)).toBe(true);
	});

	it("the committed fixture exercises backfill (tailPage.moreBefore + nonempty backwardPages)", () => {
		const artifact = JSON.parse(
			readFileSync("tests/fixtures/pty-real-session.json", "utf8"),
		) as {
			tailPage?: { moreBefore?: boolean };
			backwardPages?: unknown[];
		};
		expect(artifact.tailPage?.moreBefore).toBe(true);
		expect((artifact.backwardPages ?? []).length).toBeGreaterThan(0);
	});

	it("an old-shape { subscribe, pages } artifact still validates (umbrella §87)", () => {
		const artifact = JSON.parse(
			readFileSync("tests/fixtures/pty-real-session.json", "utf8"),
		) as { subscribe: unknown; pages: unknown };
		const oldShape = { subscribe: artifact.subscribe, pages: artifact.pages };
		expect(PtyFixtureArtifactSchema.safeParse(oldShape).success).toBe(true);
	});
});
