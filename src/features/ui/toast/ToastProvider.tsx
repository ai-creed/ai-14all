import { Toaster, toast } from "sonner";

export function notifyToast(message: string): void {
	toast(message);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
	return (
		<>
			{children}
			<Toaster
				position="bottom-right"
				toastOptions={{
					className:
						"bg-popover text-popover-foreground border border-border shadow-md font-[var(--font-ui)] text-sm",
				}}
			/>
		</>
	);
}

export function useToastContext() {
	return {
		show: (message: string) => toast(message),
		dismiss: (id: string) => toast.dismiss(id),
	};
}
