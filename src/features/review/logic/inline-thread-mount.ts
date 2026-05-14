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

	function addThread(opts: AddThreadOptions): InlineThreadHandle {
		const domNode = document.createElement("div");
		domNode.className = "shell-inline-thread-host";
		let id = "";
		let height = opts.initialHeight;
		modified.changeViewZones((accessor) => {
			id = accessor.addZone({
				afterLineNumber: opts.lineNumber,
				heightInPx: height,
				domNode,
				suppressMouseDown: false,
			});
		});
		const handle: InlineThreadHandle = {
			id,
			domNode,
			getHeight: () => height,
			setHeight(px: number) {
				if (px === height) return;
				height = px;
				const oldId = id;
				modified.changeViewZones((accessor) => {
					accessor.removeZone(oldId);
					id = accessor.addZone({
						afterLineNumber: opts.lineNumber,
						heightInPx: height,
						domNode,
						suppressMouseDown: false,
					});
				});
				handle.id = id;
				handles.delete(oldId);
				handles.set(id, handle);
			},
			remove() {
				modified.changeViewZones((accessor) => accessor.removeZone(id));
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
		handles.clear();
	}

	return { addThread, disposeAll };
}
