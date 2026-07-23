// tests/integration/xbp/session-report-granted-scopes.test.ts
// Child spec §1.1: the host disclosing the pairing's live grant set through
// session-report is the phone's ONLY authoritative dock-gate signal. v8's
// SessionReportResult declares the optional field, so a plain client.call
// round-trips it.
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createInMemoryPair,
	createNodeSodiumBackend,
	generateIdentity,
	Peer,
} from "@xavier/xbp/node";
import { sessionReportCapability } from "@ai-creed/command-contract";
import { XbpAuditSink } from "../../../services/xbp/xbp-audit-sink";
import { XbpPeerSession } from "../../../services/xbp/xbp-peer-session";
import {
	NEW_PAIRING_GRANTS,
	grantsForStoredDevice,
} from "../../../services/xbp/xbp-grants";

async function setupSession(grants: string[]) {
	const backend = await createNodeSodiumBackend();
	const [hostT, clientT] = createInMemoryPair();
	const audit = new XbpAuditSink({
		dir: mkdtempSync(join(tmpdir(), "xbp-grants-disclosure-")),
	});
	const hostIdentity = generateIdentity(backend);
	const clientIdentity = generateIdentity(backend);
	const session = new XbpPeerSession({
		backend,
		identity: hostIdentity,
		transport: hostT,
		audit,
		getSessionReport: async () => ({
			mode: "ready",
			focus: null,
			sessions: [],
		}),
	});
	session.attach(
		clientIdentity.sign.publicKey,
		clientIdentity.box.publicKey,
		grants,
	);
	const client = new Peer({
		backend,
		identity: clientIdentity,
		transport: clientT,
	});
	const hostNode = client.addPeer(
		hostIdentity.sign.publicKey,
		hostIdentity.box.publicKey,
		[],
	);
	client.start();
	return { session, client, hostNode };
}

describe("session-report grantedScopes disclosure (child spec §1.1)", () => {
	it("a full V1 pairing sees its exact grant set, control:pty-write included", async () => {
		const { session, client, hostNode } = await setupSession([
			...NEW_PAIRING_GRANTS,
		]);
		const report = await client.call(hostNode, sessionReportCapability, {});
		expect(report.grantedScopes).toEqual([...NEW_PAIRING_GRANTS]);
		expect(report.grantedScopes).toContain("control:pty-write");
		session.stop();
	});

	it("a legacy read-only pairing sees exactly its own set — control:pty-write omitted, never a superset", async () => {
		const legacyGrants = grantsForStoredDevice({
			signPubHex: "unused",
			boxPubHex: "unused",
			pairedAt: 1,
			// deliberately NO grantedPermissions — pre-2b.2 record
		});
		const { session, client, hostNode } = await setupSession(legacyGrants);
		const report = await client.call(hostNode, sessionReportCapability, {});
		expect(report.grantedScopes).toEqual(legacyGrants);
		expect(report.grantedScopes).not.toContain("control:pty-write");
		session.stop();
	});
});
