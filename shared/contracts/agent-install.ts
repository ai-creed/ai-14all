import { z } from "zod";

export const AGENT_INSTALL_LIST = "agentInstall:listProviders" as const;
export const AGENT_INSTALL_DO = "agentInstall:install" as const;
export const AGENT_INSTALL_UNINSTALL = "agentInstall:uninstall" as const;
export const AGENT_INSTALL_STATUS = "agentInstall:status" as const;
export const AGENT_INSTALL_PICK_CLI = "agentInstall:pickCliPath" as const;
export const AGENT_INSTALL_SET_OVERRIDE =
	"agentInstall:setCliOverride" as const;

export const ProviderIdSchema = z.enum(["claude-code", "codex"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const CliSourceSchema = z.enum([
	"override",
	"path",
	"fixed",
	"shell",
	"none",
]);
export type CliSource = z.infer<typeof CliSourceSchema>;

export const ProviderRowSchema = z.object({
	id: ProviderIdSchema,
	displayName: z.string(),
	cliAvailable: z.boolean(),
	configRootDetected: z.boolean(),
	installed: z.boolean(),
	cliPath: z.string().nullable(),
	cliSource: CliSourceSchema,
});
export const ListProvidersResponseSchema = z.object({
	providers: z.array(ProviderRowSchema),
	mcp: z.object({
		port: z.number().nullable(),
		bindError: z.string().nullable(),
	}),
});

export const InstallRequestSchema = z.object({
	providerIds: z.array(ProviderIdSchema).min(1),
});
export const InstallResponseSchema = z.object({
	results: z.array(
		z.object({
			id: ProviderIdSchema,
			ok: z.boolean(),
			message: z.string().nullable(),
		}),
	),
});

export const UninstallRequestSchema = z.object({
	providerIds: z.array(ProviderIdSchema).min(1),
});
export const UninstallResponseSchema = InstallResponseSchema;

export const PickCliPathRequestSchema = z.object({
	providerId: ProviderIdSchema,
});
export const PickCliPathResponseSchema = z.object({
	canceled: z.boolean(),
	path: z.string().nullable(),
});

export const SetCliOverrideRequestSchema = z.object({
	providerId: ProviderIdSchema,
	path: z.string().nullable(),
});
export const SetCliOverrideResponseSchema = ListProvidersResponseSchema;
