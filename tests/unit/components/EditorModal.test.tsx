import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditorModal } from "../../../src/features/viewer/EditorModal";

vi.mock("@monaco-editor/react", () => ({
	__esModule: true,
	default: (props: {
		value: string;
		onChange?: (v: string) => void;
		options?: Record<string, unknown>;
		theme?: string;
	}) => (
		<textarea
			data-testid="monaco"
			data-theme={props.theme}
			data-fontsize={String(props.options?.fontSize)}
			value={props.value}
			onChange={(e) => props.onChange?.(e.target.value)}
		/>
	),
}));

const baseProps = {
	worktreePath: "/wt",
	relativePath: "NOTES.md",
	initialContent: "hello",
	initialMtimeMs: 100,
	theme: "dark" as const,
	onClose: vi.fn(),
};

describe("EditorModal", () => {
	it("mounts with content and passes theme + fontSize to Monaco", () => {
		render(<EditorModal {...baseProps} />);
		const m = screen.getByTestId("monaco") as HTMLTextAreaElement;
		expect(m.value).toBe("hello");
		expect(m.dataset.theme).toBe("vs-dark");
		expect(m.dataset.fontsize).toBe("11");
	});

	it("closes immediately when clean and user clicks Close", async () => {
		const onClose = vi.fn();
		render(<EditorModal {...baseProps} onClose={onClose} />);
		await userEvent.click(screen.getByRole("button", { name: /close/i }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("uses vs theme when theme prop is light", () => {
		render(<EditorModal {...baseProps} theme="light" />);
		expect(screen.getByTestId("monaco").dataset.theme).toBe("vs");
	});
});
