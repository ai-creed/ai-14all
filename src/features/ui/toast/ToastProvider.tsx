import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

type ToastItem = { id: string; message: string };
const MAX = 3;
const TTL_MS = 4000;

type Ctx = {
	show: (message: string) => void;
	dismiss: (id: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

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
							✕
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
