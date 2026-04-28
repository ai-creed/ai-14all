import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ProviderIdSchema, type ProviderId } from "../../../shared/contracts/agent-install.js";

// Zod 4: z.record(enum, ...) requires every key. z.partialRecord allows
// payloads that contain only a subset of provider keys.
const PersistedSchema = z.partialRecord(ProviderIdSchema, z.string().nullable());

export type OverrideMap = Partial<Record<ProviderId, string | null>>;

export class CliOverrideStore {
	constructor(private readonly filePath: string) {}

	async load(): Promise<OverrideMap> {
		let raw: string;
		try {
			raw = await readFile(this.filePath, "utf-8");
		} catch {
			return {};
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return {};
		}
		const result = PersistedSchema.safeParse(parsed);
		if (!result.success) return {};
		return result.data;
	}

	async set(id: ProviderId, path: string | null): Promise<void> {
		const current = await this.load();
		const next: OverrideMap = { ...current, [id]: path };
		await mkdir(dirname(this.filePath), { recursive: true });
		const tmp = join(
			dirname(this.filePath),
			`.${id}-cli-overrides.tmp-${process.pid}`,
		);
		await writeFile(tmp, JSON.stringify(next, null, 2), "utf-8");
		await rename(tmp, this.filePath);
	}
}
