import { z } from "zod";

// --- Zod schemas ---

export const TerminalOutputEventSchema = z.object({
	sessionId: z.string(),
	data: z.string(),
});

export const TerminalExitEventSchema = z.object({
	sessionId: z.string(),
	exitCode: z.number().nullable(),
});

export const TerminalStateEventSchema = z.object({
	sessionId: z.string(),
	status: z.enum(["idle", "running", "exited", "error"]),
});

export const TerminalErrorEventSchema = z.object({
	sessionId: z.string(),
	message: z.string(),
});

export const TerminalWatchStateEventSchema = z.object({
	sessionId: z.string(),
	phoneOwned: z.boolean(),
	cols: z.number().int().positive().nullable(),
	rows: z.number().int().positive().nullable(),
	provider: z.string().nullable(),
	label: z.string().nullable(),
	since: z.number(),
});

// --- Payload types ---

export type TerminalOutputEvent = z.infer<typeof TerminalOutputEventSchema>;
export type TerminalExitEvent = z.infer<typeof TerminalExitEventSchema>;
export type TerminalStateEvent = z.infer<typeof TerminalStateEventSchema>;
export type TerminalErrorEvent = z.infer<typeof TerminalErrorEventSchema>;
export type TerminalWatchStateEvent = z.infer<
	typeof TerminalWatchStateEventSchema
>;

export {
	ShellEventRecordSchema,
	ShellReasonKindSchema,
	type ShellEventRecord,
	type ShellReasonKind,
} from "../models/shell-event-record.js";

export {
	REVIEW_COMMENT_CHANGED,
	ReviewCommentChangedEventSchema,
	type ReviewCommentChangedEvent,
} from "./review-comments.js";
