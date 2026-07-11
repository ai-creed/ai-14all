import { describe, expect, it, vi } from "vitest";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineCommentThread } from "../../../src/features/review/components/InlineCommentThread";
import type { ReviewComment } from "../../../shared/models/review-comment";
import type { ThreadActions } from "../../../src/features/review/logic/inline-thread-mount";

const c: ReviewComment = {
	id: "1",
	worktreeId: "w1",
	filePath: "a.ts",
	startLine: 3,
	endLine: 4,
	snippet: "x",
	body: "body text",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: "2026-05-14T00:00:00.000Z",
	addressedAt: null,
};

function noop() {}
async function noopSave(): Promise<boolean> {
	return true;
}

function renderThread(
	over: Partial<ReviewComment> & { status?: ReviewComment["status"] } = {},
	extra: {
		onSave?: (body: string) => Promise<boolean>;
		onCancelEdit?: () => void;
		onMeasureChange?: () => void;
		onRegisterActions?: (actions: ThreadActions | null) => void;
	} = {},
) {
	const { status, ...rest } = over;
	const comment: ReviewComment = {
		...c,
		...rest,
		...(status ? { status } : {}),
	};
	return render(
		<InlineCommentThread
			comment={comment}
			onToggleAddressed={noop}
			onDelete={noop}
			onSave={extra.onSave ?? noopSave}
			onCancelEdit={extra.onCancelEdit ?? noop}
			onMeasureChange={extra.onMeasureChange ?? noop}
			onRegisterActions={extra.onRegisterActions}
		/>,
	);
}

describe("InlineCommentThread", () => {
	it("renders open state with body and actions", () => {
		renderThread();
		expect(screen.getByText("body text")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /address/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
	});

	it("Edit → save calls onSave with new body", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn().mockResolvedValue(true);
		renderThread({}, { onSave });
		await user.click(screen.getByRole("button", { name: /edit/i }));
		const input = screen.getByRole("textbox");
		await user.clear(input);
		await user.type(input, "updated body");
		await user.click(screen.getByRole("button", { name: /save/i }));
		expect(onSave).toHaveBeenCalledWith("updated body");
	});

	it("addressed state shows the thin strip; clicking expands", async () => {
		const user = userEvent.setup();
		renderThread({ status: "addressed", addressedAt: c.createdAt });
		const strip = screen.getByRole("button", {
			name: /expand addressed comment/i,
		});
		expect(strip).toBeInTheDocument();
		await user.click(strip);
		expect(screen.getByText("body text")).toBeVisible();
	});

	it("calls onMeasureChange on render and after state changes", async () => {
		const user = userEvent.setup();
		const onMeasureChange = vi.fn();
		renderThread({}, { onMeasureChange });
		expect(onMeasureChange).toHaveBeenCalled();
		onMeasureChange.mockClear();
		await user.click(screen.getByRole("button", { name: /edit/i }));
		expect(onMeasureChange).toHaveBeenCalled();
	});

	it("serializes edit save: pending onSave ignores a second click; Save is disabled while pending", async () => {
		const user = userEvent.setup();
		let resolveSave: ((ok: boolean) => void) | undefined;
		const onSave = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					resolveSave = resolve;
				}),
		);
		renderThread({}, { onSave });
		await user.click(screen.getByRole("button", { name: /edit/i }));
		const saveButton = screen.getByRole("button", { name: /save/i });

		fireEvent.click(saveButton);
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(saveButton).toBeDisabled();

		fireEvent.click(saveButton);
		expect(onSave).toHaveBeenCalledTimes(1);

		resolveSave?.(true);
		await waitFor(() =>
			expect(screen.queryByRole("button", { name: /save/i })).toBeNull(),
		);
	});

	it("Cancel during edit calls onCancelEdit and discards the draft", async () => {
		const user = userEvent.setup();
		const onCancelEdit = vi.fn();
		renderThread({}, { onCancelEdit });
		await user.click(screen.getByRole("button", { name: /edit/i }));
		const input = screen.getByRole("textbox");
		await user.clear(input);
		await user.type(input, "discarded");
		await user.click(screen.getByRole("button", { name: /cancel/i }));
		expect(onCancelEdit).toHaveBeenCalledTimes(1);
		expect(screen.getByText("body text")).toBeInTheDocument();
	});

	it("registers openEdit on mount and unregisters on unmount", () => {
		const onRegisterActions = vi.fn();
		const { unmount } = renderThread({ status: "open" }, { onRegisterActions });
		expect(onRegisterActions).toHaveBeenCalledWith(
			expect.objectContaining({ openEdit: expect.any(Function) }),
		);
		const actions = onRegisterActions.mock.calls.at(-1)![0];
		act(() => actions.openEdit());
		expect(screen.getByRole("textbox")).toBeTruthy(); // edit textarea opened
		unmount();
		expect(onRegisterActions).toHaveBeenLastCalledWith(null);
	});

	it("openEdit is a no-op for addressed comments", () => {
		const onRegisterActions = vi.fn();
		renderThread({ status: "addressed" }, { onRegisterActions });
		const actions = onRegisterActions.mock.calls.at(-1)![0];
		act(() => actions?.openEdit());
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("edit textarea: Enter (no shift) triggers save with trimmed draft", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn().mockResolvedValue(true);
		renderThread({}, { onSave });
		await user.click(screen.getByRole("button", { name: /edit/i }));
		const input = screen.getByRole("textbox");
		await user.clear(input);
		await user.type(input, "updated{Enter}");
		expect(onSave).toHaveBeenCalledWith("updated");
	});

	it("edit textarea: Shift+Enter inserts a newline instead of saving", async () => {
		const user = userEvent.setup();
		const onSave = vi.fn().mockResolvedValue(true);
		renderThread({}, { onSave });
		await user.click(screen.getByRole("button", { name: /edit/i }));
		const input = screen.getByRole("textbox");
		await user.clear(input);
		await user.type(input, "line1{Shift>}{Enter}{/Shift}line2");
		expect(onSave).not.toHaveBeenCalled();
		expect((input as HTMLTextAreaElement).value).toBe("line1\nline2");
	});

	it("edit textarea: Escape with unmodified draft exits silently (no confirm)", async () => {
		const user = userEvent.setup();
		const confirmSpy = vi.spyOn(window, "confirm");
		const onCancelEdit = vi.fn();
		renderThread({}, { onCancelEdit });
		await user.click(screen.getByRole("button", { name: /edit/i }));
		const input = screen.getByRole("textbox");
		fireEvent.keyDown(input, { key: "Escape" });
		expect(confirmSpy).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.getByText("body text")).toBeInTheDocument();
		confirmSpy.mockRestore();
	});

	it("edit textarea: Escape with modified draft consults window.confirm before discarding", async () => {
		const user = userEvent.setup();
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		renderThread();
		await user.click(screen.getByRole("button", { name: /edit/i }));
		const input = screen.getByRole("textbox");
		await user.clear(input);
		await user.type(input, "changed");
		fireEvent.keyDown(input, { key: "Escape" });
		expect(confirmSpy).toHaveBeenCalledWith("Discard changes to this comment?");
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.getByText("body text")).toBeInTheDocument();
		confirmSpy.mockRestore();
	});

	it("edit textarea: Escape with modified draft stays in edit mode when confirm is declined", async () => {
		const user = userEvent.setup();
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		renderThread();
		await user.click(screen.getByRole("button", { name: /edit/i }));
		const input = screen.getByRole("textbox");
		await user.clear(input);
		await user.type(input, "changed");
		fireEvent.keyDown(input, { key: "Escape" });
		expect(confirmSpy).toHaveBeenCalled();
		expect(screen.getByRole("textbox")).toBeTruthy();
		confirmSpy.mockRestore();
	});
});
