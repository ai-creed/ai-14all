import { z } from "zod";

export const WhisperWorkflowPayload = z
	.object({
		collab_id: z.string(),
		workflow_type: z.string(),
		status: z.string(),
		halt_reason: z.string().nullable(),
		workspace_label: z.string(),
	})
	.strict();

export const WhisperPhasePayload = z
	.object({
		run_id: z.string(),
		phase_run_id: z.string(),
		phase_name: z.string(),
		phase_index: z.number().int(),
		outcome: z.string().nullable(),
		chain_id: z.string().nullable(),
	})
	.strict();

export const PAYLOAD_SCHEMAS: Record<string, z.ZodTypeAny> = {
	"whisper.workflow": WhisperWorkflowPayload,
	"whisper.phase": WhisperPhasePayload,
};
