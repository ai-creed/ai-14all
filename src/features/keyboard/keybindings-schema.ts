import { z } from "zod";

export const KeyBindingEntrySchema = z.object({
  action: z.string().min(1),
  key: z.string().min(1),
});

export const KeybindingsFileSchema = z.object({
  version: z.literal(1),
  bindings: z.array(KeyBindingEntrySchema),
});

export type KeyBindingEntry = z.infer<typeof KeyBindingEntrySchema>;
export type KeybindingsFile = z.infer<typeof KeybindingsFileSchema>;
