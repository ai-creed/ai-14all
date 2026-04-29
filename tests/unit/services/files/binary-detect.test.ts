// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isLikelyBinary } from "../../../../services/files/binary-detect.js";

describe("isLikelyBinary", () => {
	it("returns true for a buffer with NUL bytes", () => {
		expect(isLikelyBinary(Buffer.from([0x48, 0x00, 0x65]))).toBe(true);
	});
	it("returns false for plain UTF-8 text", () => {
		expect(isLikelyBinary(Buffer.from("hello world\nline two\n", "utf8"))).toBe(
			false,
		);
	});
	it("returns false for empty input", () => {
		expect(isLikelyBinary(Buffer.alloc(0))).toBe(false);
	});
	it("returns true for high-density non-printable bytes", () => {
		const buf = Buffer.alloc(100);
		for (let i = 0; i < buf.length; i++) buf[i] = 1; // SOH — non-printable
		expect(isLikelyBinary(buf)).toBe(true);
	});
});
