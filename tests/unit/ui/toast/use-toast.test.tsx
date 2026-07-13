import { describe, expect, it, vi } from "vitest";
import {
	act,
	fireEvent,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
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

describe("useToast action/ttl extension", () => {
	it("show returns an id accepted by dismiss", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		let id = "";
		act(() => {
			id = result.current.show("hello");
		});
		expect(id).not.toBe("");
		act(() => result.current.dismiss(id));
		expect(screen.queryByText("hello")).toBeNull();
	});

	it("renders the action button; click fires onSelect once and dismisses", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		const onSelect = vi.fn();
		act(() => {
			result.current.show("Comment deleted", {
				action: { label: "Undo", onSelect },
			});
		});
		const btn = screen.getByRole("button", { name: "Undo" });
		fireEvent.click(btn);
		fireEvent.click(btn); // second click on removed node must not double-fire
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("Comment deleted")).toBeNull();
	});

	it("honors ttlMs override while message-only keeps 4s default", () => {
		vi.useFakeTimers();
		const { result } = renderHook(() => useToast(), { wrapper });
		act(() => {
			result.current.show("long", { ttlMs: 6000 });
			result.current.show("short");
		});
		act(() => {
			vi.advanceTimersByTime(4500);
		});
		expect(screen.queryByText("short")).toBeNull();
		expect(screen.queryByText("long")).not.toBeNull();
		act(() => {
			vi.advanceTimersByTime(2000);
		});
		expect(screen.queryByText("long")).toBeNull();
		vi.useRealTimers();
	});

	it("keeps MAX-3 trim behavior unchanged with the extended API", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		act(() => {
			result.current.show("t1");
			result.current.show("t2");
			result.current.show("t3");
			result.current.show("t4", {
				ttlMs: 6000,
				action: { label: "Undo", onSelect: () => {} },
			});
		});
		expect(screen.queryByText("t1")).toBeNull(); // oldest trimmed at the 4th
		expect(screen.getByText("t2")).toBeTruthy();
		expect(screen.getByText("t3")).toBeTruthy();
		expect(screen.getByText("t4")).toBeTruthy();
	});
});
