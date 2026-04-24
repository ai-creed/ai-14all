import {
	_electron as electron,
	expect,
	test,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

interface Harness {
	app: ElectronApplication;
	page: Page;
	testRepo: TestRepo;
	persistedStateDir: string;
}

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL("../../package.json", import.meta.url));
const NEWER_FIXTURE = join(FIXTURE_DIR, "update-manifest-newer.yml");
const INVALID_FIXTURE = join(FIXTURE_DIR, "update-manifest-invalid.yml");

function readPkgVersion(): string {
	const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
	return pkg.version as string;
}

function materializeCurrentFixture(tmpDir: string): string {
	const template = readFileSync(
		join(FIXTURE_DIR, "update-manifest-current.yml"),
		"utf8",
	);
	const version = readPkgVersion();
	const output = join(tmpDir, "update-manifest-current.yml");
	writeFileSync(output, template.replaceAll("__CURRENT_VERSION__", version));
	return output;
}

async function launch(extraEnv: Record<string, string>): Promise<Harness> {
	const testRepo = createTestRepo();
	const persistedStateDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-update-")));
	const app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_WORKSPACE_STATE_PATH: join(persistedStateDir, "workspace-state.json"),
			...extraEnv,
		},
	});
	const page = await app.firstWindow({ timeout: 60_000 });

	// Load the workspace so the main layout (which hosts UpdateBanner) is rendered.
	const worktreeNav = page.getByRole("navigation", { name: "Worktree sessions" });
	if (!(await worktreeNav.isVisible({ timeout: 2_000 }).catch(() => false))) {
		const repoInput = page.locator("#repo-path");
		await expect(repoInput).toBeVisible({ timeout: 15_000 });
		await page.getByRole("button", { name: "Browse" }).click();
		await expect(repoInput).toHaveValue(testRepo.repoPath);
		await repoInput.press("Enter");
		await expect(worktreeNav).toBeVisible({ timeout: 15_000 });
	}

	return { app, page, testRepo, persistedStateDir };
}

async function teardown(h: Harness): Promise<void> {
	try {
		await closeApp(h.app);
	} finally {
		rmSync(h.persistedStateDir, { recursive: true, force: true });
		h.testRepo.cleanup();
	}
}

test.describe("banner appears on newer manifest and Download calls openExternal", () => {
	let h: Harness;

	test.beforeAll(async () => {
		h = await launch({ AI14ALL_E2E_UPDATE_MANIFEST_FILE: NEWER_FIXTURE });
	}, 90_000);

	test.afterAll(async () => {
		await teardown(h);
	});

	test("banner renders the advertised version", async () => {
		await expect(h.page.getByRole("status")).toBeVisible({ timeout: 15_000 });
		await expect(h.page.getByRole("status")).toContainText("99.0.0");
	});

	test("clicking Download records the DMG URL in the main-process capture", async () => {
		await h.page.getByRole("button", { name: /download/i }).click();
		await expect
			.poll(() =>
				h.app.evaluate(() => {
					type CaptureGlobal = { __AI14ALL_E2E_OPEN_EXTERNAL_CALLS__?: string[] };
					return (globalThis as CaptureGlobal).__AI14ALL_E2E_OPEN_EXTERNAL_CALLS__ ?? [];
				}),
			)
			.toContain(
				"https://github.com/ai-creed/ai-14all/releases/download/v99.0.0/ai-14all-99.0.0-arm64.dmg",
			);
	});

	test("dismiss hides the banner within the session", async () => {
		await h.page
			.getByRole("button", { name: /dismiss update notification/i })
			.click();
		await expect(h.page.getByRole("status")).toBeHidden();
	});
});

test.describe("banner stays hidden when manifest version equals current", () => {
	let h: Harness;
	let tmpDir: string;

	test.beforeAll(async () => {
		tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-update-current-")));
		const fixturePath = materializeCurrentFixture(tmpDir);
		h = await launch({ AI14ALL_E2E_UPDATE_MANIFEST_FILE: fixturePath });
	}, 90_000);

	test.afterAll(async () => {
		await teardown(h);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("no banner appears within a reasonable window", async () => {
		await h.page.waitForTimeout(5_000);
		await expect(h.page.getByRole("status")).toBeHidden();
	});
});

test.describe("banner stays hidden when manifest is invalid", () => {
	let h: Harness;

	test.beforeAll(async () => {
		h = await launch({ AI14ALL_E2E_UPDATE_MANIFEST_FILE: INVALID_FIXTURE });
	}, 90_000);

	test.afterAll(async () => {
		await teardown(h);
	});

	test("no banner appears for a rejected manifest", async () => {
		await h.page.waitForTimeout(5_000);
		await expect(h.page.getByRole("status")).toBeHidden();
	});
});
