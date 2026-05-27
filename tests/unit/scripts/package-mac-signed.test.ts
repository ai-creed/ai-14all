import { describe, expect, it } from "vitest";
import {
	parseEnvFile,
	isCompletePem,
	validateApiKeyConfig,
} from "../../../scripts/package-mac-signed.mjs";

const FULL_PEM = [
	"-----BEGIN PRIVATE KEY-----",
	"MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg",
	"abcd1234abcd1234abcd1234abcd1234abcd1234abcd",
	"-----END PRIVATE KEY-----",
].join("\n");

describe("parseEnvFile", () => {
	it("parses KEY=VALUE lines, ignoring blanks and comments", () => {
		const env = parseEnvFile(
			["# comment", "", "FOO=bar", "BAZ = qux ", "NO_EQ_LINE"].join("\n"),
		);
		expect(env.FOO).toBe("bar");
		expect(env.BAZ).toBe("qux");
		expect(env.NO_EQ_LINE).toBeUndefined();
	});

	it("strips matching surrounding quotes", () => {
		const env = parseEnvFile(['A="dq"', "B='sq'"].join("\n"));
		expect(env.A).toBe("dq");
		expect(env.B).toBe("sq");
	});

	it("captures only the first line of a multi-line value (the trap)", () => {
		// A pasted multi-line PEM under one key: the line parser only sees line 1.
		const env = parseEnvFile(`APPLE_API_KEY_P8=${FULL_PEM}`);
		expect(env.APPLE_API_KEY_P8).toBe("-----BEGIN PRIVATE KEY-----");
	});
});

describe("isCompletePem", () => {
	it("is true for a full PEM with BEGIN and END markers", () => {
		expect(isCompletePem(FULL_PEM)).toBe(true);
	});

	it("is false for just the BEGIN line (multi-line value truncated)", () => {
		expect(isCompletePem("-----BEGIN PRIVATE KEY-----")).toBe(false);
	});

	it("is false for empty or whitespace", () => {
		expect(isCompletePem("")).toBe(false);
		expect(isCompletePem("   ")).toBe(false);
	});
});

describe("validateApiKeyConfig", () => {
	it("uses the path when APPLE_API_KEY is set", () => {
		const result = validateApiKeyConfig({
			APPLE_API_KEY: "/keys/AuthKey.p8",
		});
		expect(result).toEqual({ mode: "path", path: "/keys/AuthKey.p8" });
	});

	it("prefers the path even when APPLE_API_KEY_P8 is incomplete", () => {
		const result = validateApiKeyConfig({
			APPLE_API_KEY: "/keys/AuthKey.p8",
			APPLE_API_KEY_P8: "-----BEGIN PRIVATE KEY-----",
		});
		expect(result.mode).toBe("path");
	});

	it("accepts a complete PEM in APPLE_API_KEY_P8", () => {
		const result = validateApiKeyConfig({ APPLE_API_KEY_P8: FULL_PEM });
		expect(result).toEqual({ mode: "contents", contents: FULL_PEM });
	});

	it("throws a helpful error when APPLE_API_KEY_P8 is an incomplete PEM (multi-line trap)", () => {
		expect(() =>
			validateApiKeyConfig({ APPLE_API_KEY_P8: "-----BEGIN PRIVATE KEY-----" }),
		).toThrow(/APPLE_API_KEY=/);
	});

	it("throws when neither var is set", () => {
		expect(() => validateApiKeyConfig({})).toThrow(/APPLE_API_KEY/);
	});
});
