import { describe, expect, it, vi } from "vitest";
import { handleNavResource } from "../../../../src/features/code-nav/monaco/handle-nav-resource.js";
import { encodeCortexUri } from "../../../../src/features/code-nav/nav/cortex-uri.js";
import { toFileUri } from "../../../../src/features/code-nav/nav/nav-file-uri.js";

function deps(over: Partial<Parameters<typeof handleNavResource>[3]> = {}) {
	const navigate = vi.fn(async () => {});
	const toast = vi.fn();
	return {
		navigate,
		toast,
		d: {
			getRouter: () => ({ navigate }),
			getActiveRef: () => ({
				workspaceId: "ws1",
				worktreeId: "/wt",
				worktreeRoot: "/wt",
			}),
			getToast: () => toast,
			outsideWorktreeUri: "cortex://outside",
			...over,
		},
	};
}

describe("handleNavResource", () => {
	it("routes a file:// target inside the worktree with selection line/column", async () => {
		const { navigate, d } = deps();
		const handled = await handleNavResource(
			toFileUri("/wt", "src/a.ts"),
			{ startLineNumber: 12, startColumn: 5 },
			"definition",
			d,
		);
		expect(handled).toBe(true);
		expect(navigate).toHaveBeenCalledWith({
			workspaceId: "ws1",
			worktreeId: "/wt",
			file: "src/a.ts",
			line: 12,
			column: 5,
			source: "definition",
		});
	});

	it("defaults file:// line/column to 1 when no selection", async () => {
		const { navigate, d } = deps();
		await handleNavResource(
			toFileUri("/wt", "src/a.ts"),
			undefined,
			"definition",
			d,
		);
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ line: 1, column: 1 }),
		);
	});

	it("returns false for a file:// path outside the worktree", async () => {
		const { navigate, d } = deps();
		const handled = await handleNavResource(
			"file:///other/x.ts",
			undefined,
			"definition",
			d,
		);
		expect(handled).toBe(false);
		expect(navigate).not.toHaveBeenCalled();
	});

	it("routes a cortex:// link via its decoded location", async () => {
		const { navigate, d } = deps();
		const uri = encodeCortexUri({
			workspaceId: "ws1",
			worktreeId: "/wt",
			file: "src/b.ts",
			line: 7,
		});
		const handled = await handleNavResource(uri, undefined, "link", d);
		expect(handled).toBe(true);
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ file: "src/b.ts", line: 7, source: "link" }),
		);
	});

	it("toasts and handles the outside-worktree sentinel", async () => {
		const { toast, navigate, d } = deps();
		const handled = await handleNavResource(
			"cortex://outside",
			undefined,
			"link",
			d,
		);
		expect(handled).toBe(true);
		expect(toast).toHaveBeenCalledWith("Path outside this worktree");
		expect(navigate).not.toHaveBeenCalled();
	});

	it("returns false for an unrelated scheme", async () => {
		const { navigate, d } = deps();
		const handled = await handleNavResource(
			"inmemory://model/1",
			undefined,
			"definition",
			d,
		);
		expect(handled).toBe(false);
		expect(navigate).not.toHaveBeenCalled();
	});
});
