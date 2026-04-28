import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	ProviderIdSchema,
	type ProviderId,
} from "../../../shared/contracts/agent-install.js";

// Zod 4: z.record(enum, ...) requires every key. z.partialRecord allows
// payloads that contain only a subset of provider keys.
const PersistedSchema = z.partialRecord(
	ProviderIdSchema,
	z.string().nullable(),
);

export type OverrideMap = Partial<Record<ProviderId, string | null>>;

export class CliOverrideStore {
	constructor(private readonly filePath: string) {}

	#queue: Promise<void> = Promise.resolve();

	async #sweepTmp(): Promise<void> {
		const dir = dirname(this.filePath);
		let entries: string[];
		try {
			const { readdir } = await import("node:fs/promises");
			entries = await readdir(dir);
		} catch {
			return;
		}
		const { rm } = await import("node:fs/promises");
		await Promise.allSettled(
			entries
				.filter((e) => e.startsWith(".cli-overrides.tmp-"))
				.map((e) => rm(join(dir, e), { force: true })),
		);
	}

	async load(): Promise<OverrideMap> {
		void this.#sweepTmp(); // non-blocking sweep; errors are swallowed
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
		this.#queue = this.#queue.then(() => this.#doSet(id, path));
		return this.#queue;
	}

	async #doSet(id: ProviderId, path: string | null): Promise<void> {
		const current = await this.load();
		const next: OverrideMap = { ...current, [id]: path };
		await mkdir(dirname(this.filePath), { recursive: true });
		const tmp = join(
			dirname(this.filePath),
			`.cli-overrides.tmp-${randomUUID()}`,
		);
		await writeFile(tmp, JSON.stringify(next, null, 2), "utf-8");
		await rename(tmp, this.filePath);
	}
}
