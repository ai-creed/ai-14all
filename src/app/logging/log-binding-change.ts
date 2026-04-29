import { logRendererShellEvent } from "../../features/terminals/logic/shell-event-logger";

type BindingChangeInput = {
	triggerEventId?: string | null;
	reasonKind:
		| "user_action"
		| "system_reconnect"
		| "window_lifecycle"
		| "renderer_drop"
		| "process_exit"
		| "backend_cleanup"
		| "unknown";
	reason: string;
	isExpected: boolean;
	expectedBecause: string | null;
	previousBinding: Record<string, unknown> | null;
	nextBinding: Record<string, unknown> | null;
};

/**
 * Emit a `terminal-binding-changed` shell-event with the standard envelope.
 * Centralised so the renderer always reports binding transitions in the same
 * shape regardless of which call site triggered the change.
 */
export function logBindingChange(input: BindingChangeInput): Promise<unknown> {
	return logRendererShellEvent({
		event: "terminal-binding-changed",
		windowId: null,
		triggerEventId: input.triggerEventId ?? null,
		reasonKind: input.reasonKind,
		reason: input.reason,
		isExpected: input.isExpected,
		expectedBecause: input.expectedBecause,
		data: {
			previousBinding: input.previousBinding,
			nextBinding: input.nextBinding,
		},
	});
}
