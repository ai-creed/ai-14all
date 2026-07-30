import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewCommentStore } from "../../../services/review/review-comment-store";
import { ReviewCommentService } from "../../../services/review/review-comment-service";
import { makeInjectReviewComment } from "../../../services/review/review-e2e-hook";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("makeInjectReviewComment", () => {
	it("creates through the real service and fires the real 'created' change event", async () => {
		dir = mkdtempSync(join(tmpdir(), "hero-hook-"));
		const store = new ReviewCommentStore(join(dir, "review-comments.json"));
		const service = new ReviewCommentService(store);
		await service.init();
		const events: string[] = [];
		service.onChange((kind) => events.push(kind));

		const inject = makeInjectReviewComment(service);
		const result = await inject({
			worktreeId: "/tmp/wt",
			filePath: "src/cart-badge.ts",
			startLine: 12,
			endLine: 14,
			snippet: "const count = items.length;",
			body: "Nice fix — extract BADGE_MAX into a shared constant?",
			source: "working-tree",
			commitSha: null,
		});

		expect(result.id).toBeTruthy();
		expect(events).toEqual(["created"]);
		expect(service.listOpenByWorktree("/tmp/wt")).toHaveLength(1);
	});
});
