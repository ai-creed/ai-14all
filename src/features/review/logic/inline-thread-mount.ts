import type { editor as MonacoEditor } from "monaco-editor";

export type AddThreadOptions = {
	lineNumber: number;
	initialHeight: number;
};

export type InlineThreadHandle = {
	id: string;
	domNode: HTMLDivElement;
	getHeight: () => number;
	setHeight: (px: number) => void;
	remove: () => void;
};

export type InlineThreadMount = {
	addThread: (opts: AddThreadOptions) => InlineThreadHandle;
	disposeAll: () => void;
};

export function createInlineThreadMount(
	editor: MonacoEditor.IStandaloneDiffEditor,
): InlineThreadMount {
	const modified = editor.getModifiedEditor();
	const handles = new Map<string, InlineThreadHandle>();
	// Use the overflow-guard as the host parent: it is position:relative + overflow:hidden,
	// so threads that scroll out of view are clipped, and it sits outside the view-zone
	// DOM layer that Monaco's event interception overlays cover.
	const overflowGuard =
		(modified
			.getDomNode()
			?.querySelector(".overflow-guard") as HTMLElement | null) ??
		modified.getContainerDomNode();

	function addThread(opts: AddThreadOptions): InlineThreadHandle {
		// Spacer: inside Monaco's view-zone layer, allocates vertical space only.
		const spacerNode = document.createElement("div");

		// Host: appended to overflow-guard so React content receives pointer events normally.
		const hostNode = document.createElement("div") as HTMLDivElement;
		hostNode.className = "shell-inline-thread-host";
		hostNode.style.position = "absolute";
		hostNode.style.overflow = "hidden";
		hostNode.style.top = "-9999px"; // off-screen until onDomNodeTop fires; overflow-guard clips it
		// Stop propagation so Monaco's container-level keybinding service doesn't
		// intercept keystrokes (e.g. 'e', 'x') while focus is inside our thread.
		hostNode.addEventListener("keydown", (e) => e.stopPropagation());
		// Stop mousedown so Monaco's editor-level handler doesn't steal focus.
		hostNode.addEventListener("mousedown", (e) => e.stopPropagation());
		overflowGuard.appendChild(hostNode);

		let height = opts.initialHeight;
		let spacerTop = 0;
		let id = "";
		let disposed = false;
		const disposables: Array<{ dispose(): void }> = [];

		const updatePosition = () => {
			const layout = modified.getLayoutInfo();
			hostNode.style.top = `${spacerTop}px`;
			hostNode.style.left = `${layout.contentLeft}px`;
			hostNode.style.width = `${layout.contentWidth}px`;
			hostNode.style.height = `${height}px`;
		};

		disposables.push(modified.onDidLayoutChange(updatePosition));

		const makeZoneSpec = (): MonacoEditor.IViewZone => ({
			afterLineNumber: opts.lineNumber,
			heightInPx: height,
			domNode: spacerNode,
			suppressMouseDown: false,
			onDomNodeTop: (top: number) => {
				spacerTop = top;
				updatePosition();
			},
		});

		modified.changeViewZones((accessor) => {
			id = accessor.addZone(makeZoneSpec());
		});

		const handle: InlineThreadHandle = {
			id,
			domNode: hostNode,
			getHeight: () => height,
			setHeight(px: number) {
				if (disposed || px === height) return;
				height = px;
				const oldId = id;
				modified.changeViewZones((accessor) => {
					accessor.removeZone(oldId);
					id = accessor.addZone(makeZoneSpec());
				});
				handle.id = id;
				handles.delete(oldId);
				handles.set(id, handle);
				updatePosition();
			},
			remove() {
				disposed = true;
				modified.changeViewZones((accessor) => accessor.removeZone(id));
				for (const d of disposables) d.dispose();
				hostNode.remove();
				handles.delete(id);
			},
		};
		handles.set(id, handle);
		return handle;
	}

	function disposeAll() {
		const ids = [...handles.keys()];
		modified.changeViewZones((accessor) => {
			for (const zoneId of ids) accessor.removeZone(zoneId);
		});
		for (const handle of handles.values()) {
			handle.domNode.remove();
		}
		handles.clear();
	}

	return { addThread, disposeAll };
}
