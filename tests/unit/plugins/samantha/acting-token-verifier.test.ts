import { describe, expect, it } from "vitest";
import { createActingTokenVerifier } from "../../../../services/plugins/samantha/acting-token-verifier";

describe("acting-token-verifier", () => {
	it("accepts a token matching the configured secret", () => {
		const v = createActingTokenVerifier({ readSecret: () => "s3cr3t" });
		expect(v.verify("s3cr3t")).toBe(true);
	});

	it("rejects a mismatched token", () => {
		const v = createActingTokenVerifier({ readSecret: () => "s3cr3t" });
		expect(v.verify("nope")).toBe(false);
	});

	it("rejects an undefined token", () => {
		const v = createActingTokenVerifier({ readSecret: () => "s3cr3t" });
		expect(v.verify(undefined)).toBe(false);
	});

	it("default-deny: rejects when no secret is configured", () => {
		const v = createActingTokenVerifier({ readSecret: () => null });
		expect(v.verify("anything")).toBe(false);
	});

	it("rejects when secret is configured but empty", () => {
		const v = createActingTokenVerifier({ readSecret: () => "" });
		expect(v.verify("")).toBe(false);
	});
});
