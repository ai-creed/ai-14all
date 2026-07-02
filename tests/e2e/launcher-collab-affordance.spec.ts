import {
	_electron as electron,
	expect,
	test,
	type ElectronApplication,
	type Page,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestRepo, type TestRepo } from "./fixtures/create-test-repo";
import { closeApp } from "./fixtures/close-app";

let app: ElectronApplication | undefined;
let page: Page;
let testRepo: TestRepo;
let userDataDir: string;

function boxOf(testId: string) {
	return page.evaluate((id) => {
		const el = document.querySelector(`[data-testid="${id}"]`);
		if (!el) return null;
		const s = getComputedStyle(el);
		return {
			borderTopWidth: s.borderTopWidth,
			borderStyle: s.borderTopStyle,
			background: s.backgroundColor,
		};
	}, testId);
}

test.beforeAll(async () => {
	testRepo = createTestRepo();
	userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-launcher-ud-")));
	app = await electron.launch({
		args: ["out/main/index.js"],
		env: {
			...process.env,
			AI14ALL_E2E: "1",
			AI14ALL_E2E_PICK_PATH: testRepo.repoPath,
			AI14ALL_USER_DATA_PATH: userDataDir,
		},
	});
	page = await app.firstWindow({ timeout: 60_000 });
	// The #/ui-gallery route is read at renderer module load (src/main.tsx), so
	// set the hash then reload. The route + <UiGallery> ship in this repo, so the
	// gallery is REQUIRED here — fail (not skip) if it does not render.
	await page.evaluate(() => {
		window.location.hash = "#/ui-gallery";
	});
	await page.reload();
	await expect(page.locator('[data-testid="ui-gallery"]')).toBeVisible({
		timeout: 15_000,
	});
}, 90_000);

test.afterAll(async () => {
	try {
		await closeApp(app);
	} finally {
		rmSync(userDataDir, { recursive: true, force: true });
		testRepo?.cleanup();
	}
});

test("collab status has no button-box in any tone; launcher shows a resting fill", async () => {
	for (const tone of ["muted", "amber", "accent"]) {
		const box = await boxOf(`gallery-collab-${tone}`);
		expect(box, `collab-${tone} present`).not.toBeNull();
		// No box: zero border width and transparent background in every tone.
		expect(box!.borderTopWidth).toBe("0px");
		expect(box!.background).toBe("rgba(0, 0, 0, 0)");
	}

	// The launcher, by contrast, carries a visible border AND a resting fill
	// (both are the affordance; a missing fill would be caught here).
	const btn = await boxOf("gallery-launch-claude");
	expect(btn).not.toBeNull();
	expect(btn!.borderStyle).toBe("solid");
	expect(btn!.borderTopWidth).not.toBe("0px");
	expect(btn!.background).not.toBe("rgba(0, 0, 0, 0)"); // resting fill present
});
