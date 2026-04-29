import { describe, expect, it } from "vitest";
import { decideUpdateAction } from "../../../electron/main/services/update-notifier.js";

const PUBLISHED = `version: 0.1.1
releaseDate: '2026-05-01T12:00:00.000Z'
path: https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64.dmg
sha512: ZG1nLXNoYQ==
files:
  - url: https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64.dmg
    sha512: ZG1nLXNoYQ==
    size: 1000
`;

describe("decideUpdateAction", () => {
	it("notifies when the manifest version is newer", () => {
		const result = decideUpdateAction({
			currentVersion: "0.1.0",
			manifestYaml: PUBLISHED,
		});
		expect(result.kind).toBe("notify");
		if (result.kind !== "notify") return;
		expect(result.info.version).toBe("0.1.1");
		expect(result.info.url).toBe(
			"https://github.com/ai-creed/ai-14all/releases/download/v0.1.1/ai-14all-0.1.1-arm64.dmg",
		);
	});

	it("stays silent when the manifest version equals current", () => {
		const result = decideUpdateAction({
			currentVersion: "0.1.1",
			manifestYaml: PUBLISHED,
		});
		expect(result.kind).toBe("silent");
	});

	it("stays silent when the manifest is invalid", () => {
		const broken = PUBLISHED.replace("version: 0.1.1", "version: 0.1.1-beta.1");
		const result = decideUpdateAction({
			currentVersion: "0.1.0",
			manifestYaml: broken,
		});
		expect(result.kind).toBe("silent");
	});

	it("stays silent when the current version is non-stable", () => {
		const result = decideUpdateAction({
			currentVersion: "0.1.0-beta.14",
			manifestYaml: PUBLISHED,
		});
		expect(result.kind).toBe("silent");
	});
});
