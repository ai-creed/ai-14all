import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Icon } from "@/components/ui/icon";

type ToastItem = { id: string; message: string };
const MAX = 3;
const TTL_MS = 4000;

type Ctx = {
	show: (message: string) => void;
	dismiss: (id: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

// Imperative bridge: the mounted ToastProvider registers its `show` here so code
// that runs OUTSIDE the provider subtree (e.g. App-level hooks whose JSX renders
// the provider below them) can surface a toast without the React context. No-op
// when no provider is mounted.
let activeShow: ((message: string) => void) | null = null;

export function notifyToast(message: string): void {
	activeShow?.(message);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
	const [items, setItems] = useState<ToastItem[]>([]);
	const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

	const dismiss = useCallback((id: string) => {
		setItems((prev) => prev.filter((t) => t.id !== id));
		const handle = timers.current.get(id);
		if (handle) {
			clearTimeout(handle);
			timers.current.delete(id);
		}
	}, []);

	const show = useCallback(
		(message: string) => {
			const id = crypto.randomUUID();
			setItems((prev) => {
				const trimmed = prev.length >= MAX ? prev.slice(1) : prev;
				return [...trimmed, { id, message }];
			});
			const handle = setTimeout(() => dismiss(id), TTL_MS);
			timers.current.set(id, handle);
		},
		[dismiss],
	);

	// Register this provider's `show` on the imperative bridge while mounted.
	useEffect(() => {
		activeShow = show;
		return () => {
			if (activeShow === show) activeShow = null;
		};
	}, [show]);

	useEffect(
		() => () => {
			for (const h of timers.current.values()) clearTimeout(h);
			timers.current.clear();
		},
		[],
	);

	const ctx = useMemo<Ctx>(() => ({ show, dismiss }), [show, dismiss]);

	return (
		<ToastCtx.Provider value={ctx}>
			{children}
			<div className="shell-toast-stack" role="log" aria-live="polite">
				{items.map((t) => (
					<div key={t.id} className="shell-toast">
						<span>{t.message}</span>
						<button
							type="button"
							aria-label="dismiss"
							onClick={() => dismiss(t.id)}
						>
							<Icon name="close" />
						</button>
					</div>
				))}
			</div>
		</ToastCtx.Provider>
	);
}

export function useToastContext(): Ctx {
	const ctx = useContext(ToastCtx);
	if (!ctx) throw new Error("useToast must be used inside ToastProvider");
	return ctx;
}
