import { describe, expect, it } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { ToastProvider } from "../../../../src/features/ui/toast/ToastProvider";
import { useToast } from "../../../../src/features/ui/toast/use-toast";

const wrapper = ({ children }: { children: React.ReactNode }) => (
	<ToastProvider>{children}</ToastProvider>
);

describe("useToast", () => {
	it("renders a posted toast", () => {
		const Harness = () => {
			const toast = useToast();
			return <button onClick={() => toast.show("hello")}>post</button>;
		};
		render(
			<ToastProvider>
				<Harness />
			</ToastProvider>,
		);
		act(() => {
			screen.getByRole("button", { name: /post/i }).click();
		});
		expect(screen.getByText("hello")).toBeInTheDocument();
	});

	it("dismisses on the user clicking dismiss", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		act(() => {
			result.current.show("x");
		});
		expect(screen.getByText("x")).toBeInTheDocument();
		act(() => {
			screen.getByRole("button", { name: /dismiss/i }).click();
		});
		expect(screen.queryByText("x")).toBeNull();
	});

	it("caps at 3 visible; new push evicts the oldest", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		act(() => {
			result.current.show("a");
			result.current.show("b");
			result.current.show("c");
			result.current.show("d");
		});
		expect(screen.queryByText("a")).toBeNull();
		for (const t of ["b", "c", "d"]) {
			expect(screen.getByText(t)).toBeInTheDocument();
		}
	});
});
