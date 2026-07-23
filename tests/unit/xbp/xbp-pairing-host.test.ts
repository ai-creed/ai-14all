// tests/unit/xbp/xbp-pairing-host.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createNodeSodiumBackend,
	generateIdentity,
	parsePairingOffer,
	ReferenceClient,
} from "@xavier/xbp/node";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPairingHost } from "../../../services/xbp/xbp-pairing-host";

async function makeHost(opts: { now?: () => number; ttl?: number } = {}) {
	const backend = await createNodeSodiumBackend();
	const audit = new XbpAuditSink({
		dir: mkdtempSync(join(tmpdir(), "xbp-ph-")),
	});
	const host = new XbpPairingHost({
		backend,
		identity: generateIdentity(backend),
		audit,
		pairingTokenTtlMs: opts.ttl,
		now: opts.now,
	});
	return { backend, audit, host };
}

describe("XbpPairingHost", () => {
	it("creates a parseable offer carrying the LAN url and host keys", async () => {
		const { host } = await makeHost();
		const offer = host.createOffer({ urls: ["ws://10.0.0.5:51820"] });
		const parsed = parsePairingOffer(JSON.stringify(offer));
		expect(parsed?.connect.urls[0]).toBe("ws://10.0.0.5:51820");
		expect(parsed?.signPubHex.length).toBeGreaterThan(0);
		expect(offer.expiresAt).toBeGreaterThan(0);
	});

	it("embeds an expiry that respects the configured TTL", async () => {
		const { host } = await makeHost({ now: () => 1_000_000, ttl: 180_000 });
		const offer = host.createOffer({ urls: ["ws://10.0.0.5:51820"] });
		expect(offer.expiresAt).toBe(1_000_000 + 180_000);
	});

	it("rejects a pair-request presented after the token TTL — no pairing, audited 'rejected'", async () => {
		let clock = 1_000_000;
		const { backend, audit, host } = await makeHost({
			now: () => clock,
			ttl: 1_000,
		});
		const offer = host.createOffer({ urls: ["ws://10.0.0.5:51820"] });
		const client = new ReferenceClient({
			backend,
			identity: generateIdentity(backend),
		});
		const pairRequest = client.buildPairRequest(offer.token);

		clock += 5_000; // advance well past the 1s TTL
		host.handle(pairRequest);

		expect(host.isPaired).toBe(false);
		expect(host.lastSas).toBeNull();
		expect(audit.entries().some((e) => e.outcome === "rejected")).toBe(true);
	});

	it("computes a 6-digit SAS for a fresh in-TTL pair-request (positive control + SAS source)", async () => {
		const clock = 1_000_000;
		const { backend, host } = await makeHost({ now: () => clock, ttl: 60_000 });
		const offer = host.createOffer({ urls: ["ws://10.0.0.5:51820"] });
		const client = new ReferenceClient({
			backend,
			identity: generateIdentity(backend),
		});
		host.handle(client.buildPairRequest(offer.token)); // within TTL
		expect(host.lastSas).toMatch(/^\d{6}$/);
	});
});
