import { z } from "zod";
import { PtyRowsResult, SubscribePtyResult } from "@ai-creed/command-contract";

// Validates the fixture artifact (reflow child spec §3, umbrella §6.2):
// { subscribe: { cols, epoch, watermark }, pages: PtyRowsPage[] }.
// Elements are stored WITHOUT the `ok: true` wire envelope — the same shape
// serializePage returns before pty-subscription-registry stamps `ok` onto
// the wire. The contract result schemas are discriminated unions requiring
// `ok: true`, so validation re-adds the envelope per element; artifact
// validity therefore implies wire validity.
export const PtyFixtureArtifactSchema = z
	.object({
		subscribe: z.object({
			cols: z.number().int().positive(),
			epoch: z.number().int().nonnegative(),
			watermark: z.number().int().nonnegative(),
		}),
		pages: z.array(z.record(z.string(), z.unknown())),
	})
	.superRefine((artifact, ctx) => {
		const sub = SubscribePtyResult.safeParse({
			...artifact.subscribe,
			ok: true,
		});
		if (!sub.success) {
			ctx.addIssue({
				code: "custom",
				path: ["subscribe"],
				message: `subscribe fails SubscribePtyResult: ${sub.error.message}`,
			});
		}
		artifact.pages.forEach((page, i) => {
			const parsed = PtyRowsResult.safeParse({ ...page, ok: true });
			if (!parsed.success) {
				ctx.addIssue({
					code: "custom",
					path: ["pages", i],
					message: `page ${i} fails PtyRowsResult: ${parsed.error.message}`,
				});
			}
		});
	});

export type PtyFixtureArtifactInput = z.input<typeof PtyFixtureArtifactSchema>;
