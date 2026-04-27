import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createServer } from "node:net";

type Range = { rangeStart: number; rangeEnd: number };

async function tryBind(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const srv = createServer();
		srv.once("error", () => resolve(false));
		srv.listen(port, "127.0.0.1", () => {
			srv.close(() => resolve(true));
		});
	});
}

export async function loadOrPickPort(
	configPath: string,
	range: Range,
): Promise<number> {
	try {
		const raw = await readFile(configPath, "utf-8");
		const parsed = JSON.parse(raw) as { port?: number };
		if (typeof parsed.port === "number" && Number.isInteger(parsed.port)) {
			return parsed.port;
		}
	} catch {
		// fall through to first-install probe
	}

	const span = range.rangeEnd - range.rangeStart + 1;
	const candidates = Array.from(
		{ length: span },
		(_, i) => range.rangeStart + i,
	).sort(() => Math.random() - 0.5);
	for (const candidate of candidates) {
		if (await tryBind(candidate)) {
			await mkdir(dirname(configPath), { recursive: true });
			const tmp = `${configPath}.ai-14all.tmp`;
			await writeFile(tmp, JSON.stringify({ port: candidate }), "utf-8");
			await rename(tmp, configPath);
			return candidate;
		}
	}
	throw new Error(
		`No free port available in range ${range.rangeStart}-${range.rangeEnd}`,
	);
}

export async function writeLivenessFile(
	path: string,
	port: number,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, String(port), "utf-8");
}

export async function deleteLivenessFile(path: string): Promise<void> {
	await unlink(path).catch(() => {});
}
