// One-shot visual smoke driver for the four smoke-test UI fixes.
// Mirrors tests/e2e fixtures: temp repo + feature-a worktree, E2E env launch.
import { _electron as electron, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHOTS = "/tmp/ai14all-shots";
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail) => {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- temp repo (replicates tests/e2e/fixtures/create-test-repo.ts) ----
const repoPath = realpathSync(mkdtempSync(join(tmpdir(), "ofa-smoke-")));
const sh = (cmd, cwd = repoPath) => execSync(cmd, { cwd, stdio: "ignore" });
sh("git init -b main");
sh("git config user.email e2e@test.com && git config user.name E2E");
mkdirSync(join(repoPath, "src"), { recursive: true });
writeFileSync(join(repoPath, "src/index.ts"), 'export const hello = "world";\n');
writeFileSync(join(repoPath, "README.md"), "# Test Repo\n");
sh("git add -A && git commit -m init");
sh("git update-ref refs/remotes/origin/master HEAD");
sh("git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master");
sh("git branch feature-a");
mkdirSync(join(repoPath, ".worktrees"), { recursive: true });
sh(`git worktree add "${join(repoPath, ".worktrees/feature-a")}" feature-a`);
const wt = realpathSync(join(repoPath, ".worktrees/feature-a"));
writeFileSync(join(wt, "NOTES.md"), "# Preview Test\n\nSmoke.\n");

const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-smoke-state-")));
const userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-smoke-ud-")));

// ---- launch ----
const app = await electron.launch({
	args: ["out/main/index.js"],
	env: {
		...process.env,
		AI14ALL_E2E: "1",
		AI14ALL_E2E_PICK_PATH: repoPath,
		AI14ALL_WORKSPACE_STATE_PATH: join(stateDir, "workspace-state.json"),
		AI14ALL_USER_DATA_PATH: userDataDir,
	},
});
const page = await app.firstWindow({ timeout: 60_000 });
console.log("launched:", page.url());

try {
	// ---- load repo, select feature-a session ----
	await page.getByRole("button", { name: "Browse" }).click();
	await expect(page.locator("#repo-path")).toHaveValue(repoPath);
	await page.getByRole("button", { name: "Load" }).click();
	const featureA = page
		.getByRole("navigation", { name: "Worktree sessions" })
		.getByRole("button", { name: "feature-a", exact: true });
	await expect(featureA).toBeVisible({ timeout: 15_000 });
	await featureA.click();
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SHOTS}/01-loaded.png` });

	// ---- FIX 1: pointer cursor on enabled buttons ----
	const cursors = await page.evaluate(() => {
		const enabled = [...document.querySelectorAll("button:not(:disabled)")];
		const sample = enabled.slice(0, 30).map((b) => ({
			label: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 25),
			cursor: getComputedStyle(b).cursor,
		}));
		const disabled = [...document.querySelectorAll("button:disabled")].map(
			(b) => getComputedStyle(b).cursor,
		);
		return { sample, disabledCursors: [...new Set(disabled)] };
	});
	const bad = cursors.sample.filter((c) => c.cursor !== "pointer");
	check(
		"fix1: enabled buttons use pointer cursor",
		bad.length === 0,
		bad.length ? `non-pointer: ${JSON.stringify(bad.slice(0, 5))}` : `${cursors.sample.length} sampled, disabled=[${cursors.disabledCursors}]`,
	);

	// ---- FIX 3 + 4: note drawer docked right, single close button ----
	await page.getByRole("button", { name: /open note/i }).click();
	await expect(page.getByRole("textbox", { name: /session note/i })).toBeVisible({ timeout: 5_000 });
	await page.waitForTimeout(400); // let enter animation settle
	await page.screenshot({ path: `${SHOTS}/02-note-drawer.png` });
	const geo = await page.evaluate(() => {
		const el = document.querySelector(".shell-note-sheet");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return {
			left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width,
			winW: window.innerWidth, winH: window.innerHeight,
		};
	});
	const docked =
		geo &&
		Math.abs(geo.right - geo.winW) < 2 &&
		Math.abs(geo.top) < 2 &&
		Math.abs(geo.bottom - geo.winH) < 2 &&
		geo.left > geo.winW * 0.4;
	check("fix3: note drawer docked to right edge, full height", !!docked, JSON.stringify(geo));
	const noteCloses = await page.evaluate(() => {
		const dlg = document.querySelector("[role=dialog]");
		if (!dlg) return -1;
		return [...dlg.querySelectorAll("button")].filter((b) =>
			/close/i.test(b.getAttribute("aria-label") || b.textContent || ""),
		).length;
	});
	check("fix4: note dialog has exactly one close button", noteCloses === 1, `found ${noteCloses}`);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("textbox", { name: /session note/i })).toHaveCount(0);

	// ---- FIX 2: dirty bar Save/Discard styled (review overlay → Files → NOTES.md) ----
	const portal = page.getByTestId("review-expanded-portal");
	if (!(await portal.isVisible().catch(() => false))) {
		await page.getByRole("button", { name: /^open review$/i }).click();
	}
	await expect(portal).toBeVisible();
	await page.waitForTimeout(300);
	await page.getByRole("tab", { name: "Files" }).click({ force: true });
	const notesRow = page.locator(".shell-list__item--tree").filter({ hasText: /^NOTES\.md/ });
	await expect(notesRow).toBeVisible({ timeout: 15_000 });
	await notesRow.click();
	await expect(page.getByTestId("inline-editor")).toBeVisible({ timeout: 10_000 });
	await page.locator(".monaco-editor .view-lines").first().click();
	await page.keyboard.press("Meta+End");
	await page.keyboard.type("\nSMOKE EDIT\n");
	const dirtyBar = page.getByTestId("editor-dirty-bar");
	await expect(dirtyBar).toBeVisible({ timeout: 5_000 });
	await page.screenshot({ path: `${SHOTS}/03-dirty-bar.png` });
	const btnStyle = await page.evaluate(() => {
		const bar = document.querySelector('[data-testid="editor-dirty-bar"]');
		const save = [...bar.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save");
		const discard = [...bar.querySelectorAll("button")].find((b) => b.textContent.trim() === "Discard");
		const pick = (el) => {
			const s = getComputedStyle(el);
			return { h: el.getBoundingClientRect().height, bg: s.backgroundColor, radius: s.borderRadius, cursor: s.cursor };
		};
		return { save: save && pick(save), discard: discard && pick(discard) };
	});
	const styled =
		btnStyle.save && btnStyle.discard &&
		Math.round(btnStyle.save.h) === 32 &&
		btnStyle.save.bg !== "rgba(0, 0, 0, 0)" &&
		btnStyle.discard.bg !== "rgba(0, 0, 0, 0)" &&
		btnStyle.save.cursor === "pointer";
	check("fix2: dirty-bar Save/Discard styled as shadcn buttons", !!styled, JSON.stringify(btnStyle));
	// discard the edit so nothing lingers
	page.once("dialog", (d) => d.accept());
	await dirtyBar.getByRole("button", { name: /discard/i }).click().catch(() => {});
	await page.waitForTimeout(300);

	// ---- bonus: dialogs keeping built-in X (files overlay) ----
	await page.keyboard.press("Escape"); // close review overlay
	await page.waitForTimeout(300);
} catch (e) {
	console.log("DRIVE ERROR:", e.message);
	await page.screenshot({ path: `${SHOTS}/99-error.png` }).catch(() => {});
}

await app.close().catch(() => {});
console.log("\nsummary:", results.filter((r) => r.ok).length, "/", results.length, "checks passed");
console.log("screenshots in", SHOTS);
process.exit(results.every((r) => r.ok) ? 0 : 1);
