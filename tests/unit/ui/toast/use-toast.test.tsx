import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mockToast = vi.hoisted(() =>
	Object.assign(vi.fn(), {
		dismiss: vi.fn(),
	}),
);

vi.mock("sonner", () => ({
	toast: mockToast,
	Toaster: () => null,
}));

import {
	ToastProvider,
	notifyToast,
	useToastContext,
} from "../../../../src/features/ui/toast/ToastProvider";
import { useToast } from "../../../../src/features/ui/toast/use-toast";

const wrapper = ({ children }: { children: React.ReactNode }) => (
	<ToastProvider>{children}</ToastProvider>
);

describe("useToast", () => {
	it("show() calls sonner toast with the message", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		result.current.show("hello");
		expect(mockToast).toHaveBeenCalledWith("hello");
	});

	it("dismiss() calls sonner toast.dismiss with the id", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		result.current.dismiss("toast-1");
		expect(mockToast.dismiss).toHaveBeenCalledWith("toast-1");
	});

	it("useToast is the same hook as useToastContext", () => {
		expect(useToast).toBe(useToastContext);
	});
});

describe("notifyToast", () => {
	it("calls sonner toast with the message", () => {
		mockToast.mockClear();
		notifyToast("standalone message");
		expect(mockToast).toHaveBeenCalledWith("standalone message");
	});
});
