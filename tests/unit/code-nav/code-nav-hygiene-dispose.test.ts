import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { CodeNavHygiene } from "../../../src/features/code-nav/CodeNavHygiene.js";
import { setModelProvisioner } from "../../../src/features/code-nav/nav/router-singleton.js";
import type { ModelProvisioner } from "../../../src/features/code-nav/monaco/model-provisioner.js";

describe("CodeNavHygiene worktree-switch disposal", () => {
	it("disposes provisioner models on unmount (worktree switch)", () => {
		const disposeAll = vi.fn();
		setModelProvisioner({
			disposeAll,
			ensureModel: vi.fn(),
		} as unknown as ModelProvisioner);
		const { unmount } = render(
			createElement(CodeNavHygiene, {
				workspaceId: "ws1",
				worktreeId: "/wt",
				worktreeRoot: "/wt",
			}),
		);
		unmount();
		expect(disposeAll).toHaveBeenCalled();
		setModelProvisioner(null);
	});
});
