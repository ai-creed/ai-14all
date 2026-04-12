import { z } from "zod";

export const ShellReasonKindSchema = z.enum([
	"user_action",
	"system_reconnect",
	"window_lifecycle",
	"process_exit",
	"backend_cleanup",
	"renderer_drop",
	"unknown",
]);

export const ShellEventRecordSchema = z.object({
	at: z.string(),
	runId: z.string(),
	seq: z.number().int().positive(),
	source: z.enum(["main", "renderer"]),
	eventId: z.string(),
	event: z.string(),
	windowId: z.number().int().nullable(),
	rendererAt: z.string().nullable().optional(),
	rendererSeq: z.number().int().positive().nullable().optional(),
	reasonKind: ShellReasonKindSchema.nullable().optional(),
	reason: z.string().nullable().optional(),
	triggerEventId: z.string().nullable().optional(),
	isExpected: z.boolean().nullable().optional(),
	expectedBecause: z.string().nullable().optional(),
	data: z.record(z.string(), z.unknown()),
});

export type ShellEventRecord = z.infer<typeof ShellEventRecordSchema>;
export type ShellReasonKind = z.infer<typeof ShellReasonKindSchema>;
