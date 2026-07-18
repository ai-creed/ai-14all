// Frozen v4 `pty-rows` result schema, copied VERBATIM from
// @ai-creed/command-contract 0.1.0-alpha.3
// (vendor/ai-creed-command-contract-0.1.0-alpha.3.tgz,
// src/capabilities/pty-inspect.ts). Provenance: reflow child spec §1 test 8.
// Do NOT update this module when the vendored contract moves — its whole
// purpose is to prove the umbrella §3 new-host → old-phone rule: a v4
// parser strips the unknown `wrapped` key from an unmodified v5 payload.
import { z } from "zod";

const PtyColor = z.union([
	z.number().int().min(0).max(255),
	z.object({
		r: z.number().int().min(0).max(255),
		g: z.number().int().min(0).max(255),
		b: z.number().int().min(0).max(255),
	}),
]);

const PtyStyleRun = z.object({
	start: z.number().int().nonnegative(),
	len: z.number().int().nonnegative(),
	fg: PtyColor.optional(),
	bg: PtyColor.optional(),
	bold: z.literal(true).optional(),
	dim: z.literal(true).optional(),
	italic: z.literal(true).optional(),
	underline: z.literal(true).optional(),
	inverse: z.literal(true).optional(),
});

const PtyRow = z.object({
	line: z.number().int().nonnegative(),
	text: z.string(),
	runs: z.array(PtyStyleRun),
});

const PtyErrorCode = z.enum(["no-live-agent", "no-such-pty", "internal"]);

const ptyRefusal = z.object({
	ok: z.literal(false),
	code: PtyErrorCode,
	message: z.string().optional(),
});

export const V4PtyRowsResult = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		epoch: z.number().int().nonnegative(),
		cols: z.number().int().positive(),
		altScreen: z.boolean(),
		watermark: z.number().int().nonnegative(),
		trimmedBefore: z.number().int().nonnegative(),
		rows: z.array(PtyRow),
		cursor: z.string(),
		more: z.boolean(),
	}),
	ptyRefusal,
]);
