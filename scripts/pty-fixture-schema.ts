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
		// Strict: the stored shape is exactly { cols, epoch, watermark } —
		// spec §3 forbids the wire envelope (or anything else) in storage, and
		// a non-strict object would silently strip a stored `ok` before the
		// superRefine below could see it.
		subscribe: z.strictObject({
			cols: z.number().int().positive(),
			epoch: z.number().int().nonnegative(),
			watermark: z.number().int().nonnegative(),
		}),
		pages: z.array(z.record(z.string(), z.unknown())),
		tailPage: z.record(z.string(), z.unknown()).optional(),
		backwardPages: z.array(z.record(z.string(), z.unknown())).optional(),
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
		// Declared BEFORE any use. Envelope-free storage guard (spec §3): a stored
		// `ok` is indistinguishable from the stamp below, so its mere presence is a
		// violation; otherwise parse against the vendored contract with ok re-added.
		const checkStoredPage = (
			page: Record<string, unknown>,
			path: (string | number)[],
		) => {
			if ("ok" in page) {
				ctx.addIssue({
					code: "custom",
					path,
					message:
						'page carries the wire envelope key "ok" — stored pages must be envelope-free',
				});
				return;
			}
			const parsed = PtyRowsResult.safeParse({ ...page, ok: true });
			if (!parsed.success) {
				ctx.addIssue({
					code: "custom",
					path,
					message: `page fails PtyRowsResult: ${parsed.error.message}`,
				});
			}
		};
		artifact.pages.forEach((page, i) => checkStoredPage(page, ["pages", i]));
		if (artifact.tailPage) checkStoredPage(artifact.tailPage, ["tailPage"]);
		artifact.backwardPages?.forEach((bp, i) =>
			checkStoredPage(bp, ["backwardPages", i]),
		);
	});

export type PtyFixtureArtifactInput = z.input<typeof PtyFixtureArtifactSchema>;
