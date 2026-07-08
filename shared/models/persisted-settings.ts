import { z } from "zod";
import {
	RestorePreferenceSchema,
	UsageTelemetrySettingsSchema,
} from "./persisted-workspace-state";

export const ThemeModeSchema = z.enum([
	"light",
	"dark",
	"system",
	"warm",
	"tui",
]);
export const RestoreDepthSchema = z.enum([
	"stateEagerTerminalsLazy",
	"activeOnly",
]);
export const AgentResumeModeSchema = z.enum(["auto", "manual", "off"]);
export const PhoneBridgeSettingsSchema = z.object({
	enabled: z.boolean(),
});

// Range mirrors MIN/MAX_TERMINAL_FONT_SIZE in use-terminal-font-size.ts.
const TerminalFontSizeSchema = z.number().int().min(10).max(20);

export const PersistedSettingsV1Schema = z.object({
	version: z.literal(1),
	theme: ThemeModeSchema.default("system"),
	terminalFontSize: TerminalFontSizeSchema.default(13),
	restorePreference: RestorePreferenceSchema.default("prompt"),
	restoreDepth: RestoreDepthSchema.default("stateEagerTerminalsLazy"),
	agentResume: AgentResumeModeSchema.default("auto"),
	usageTelemetry: UsageTelemetrySettingsSchema.default({
		enabled: true,
		includeUntracked: false,
		chipRange: "week",
	}),
	phoneBridge: PhoneBridgeSettingsSchema.default({ enabled: false }),
});

export type ThemeMode = z.infer<typeof ThemeModeSchema>;
export type RestoreDepth = z.infer<typeof RestoreDepthSchema>;
export type AgentResumeMode = z.infer<typeof AgentResumeModeSchema>;
export type PersistedSettingsV1 = z.infer<typeof PersistedSettingsV1Schema>;

// Bare (non-`.default()`) mirror of UsageTelemetrySettingsSchema's fields, for
// the same reason the top-level fields below avoid `.default()` (see comment
// below): reusing UsageTelemetrySettingsSchema as-is for the nested
// `usageTelemetry` patch would mean a sub-patch of just `{ enabled: false }`
// re-injects zod's own defaults (`includeUntracked: false`, `chipRange:
// "week"`) as explicit values on parse — verified via a standalone repro —
// silently discarding whatever SettingsService.writeState()'s deep-merge was
// meant to preserve.
const UsageTelemetryPatchSchema = z.object({
	enabled: z.boolean().optional(),
	includeUntracked: z.boolean().optional(),
	chipRange: z.enum(["week", "month"]).optional(),
});

const PhoneBridgePatchSchema = z.object({
	enabled: z.boolean().optional(),
});

// Built from the bare (non-`.default()`) field schemas rather than
// `PersistedSettingsV1Schema.omit({version:true}).partial()`: in zod v4 a
// field's `.default()` resolves on `undefined` input regardless of
// `.optional()`/`.partial()` wrapping order (verified for both `.partial()`
// and `.strict().partial()`), so the omit+partial derivation fills in every
// default instead of leaving unset keys absent. `.strict()` is intentionally
// not applied either — unknown keys (e.g. a stray `version`) are silently
// stripped by the default object mode instead of rejected.
export const SettingsPatchSchema = z.object({
	theme: ThemeModeSchema.optional(),
	terminalFontSize: TerminalFontSizeSchema.optional(),
	restorePreference: RestorePreferenceSchema.optional(),
	restoreDepth: RestoreDepthSchema.optional(),
	agentResume: AgentResumeModeSchema.optional(),
	usageTelemetry: UsageTelemetryPatchSchema.optional(),
	phoneBridge: PhoneBridgePatchSchema.optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_PERSISTED_SETTINGS: PersistedSettingsV1 =
	PersistedSettingsV1Schema.parse({ version: 1 });

/** Single source of truth for the phone-bridge feature gate (spec D2). */
export function isPhoneBridgeEnabled(s: PersistedSettingsV1): boolean {
	return s.phoneBridge.enabled;
}
