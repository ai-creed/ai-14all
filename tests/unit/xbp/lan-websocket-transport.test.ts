// tests/unit/xbp/lan-websocket-transport.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { once } from "node:events";
import WebSocket from "ws";
import type { networkInterfaces } from "node:os";
import {
	createLanWebSocketHost,
	pickPrimaryLanIPv4,
	pickTailscaleIPv4,
	primaryLanIPv4,
} from "../../../services/xbp/lan-websocket-transport";

let host: Awaited<ReturnType<typeof createLanWebSocketHost>> | undefined;
afterEach(async () => {
	await host?.close();
	host = undefined;
});

describe("lan-websocket-transport", () => {
	it("binds a dynamic port and returns it", async () => {
		host = await createLanWebSocketHost();
		expect(host.port).toBeGreaterThan(0);
	});

	it("fans every inbound frame out to all onFrame subscribers", async () => {
		host = await createLanWebSocketHost();
		const a: Uint8Array[] = [];
		const b: Uint8Array[] = [];
		host.transport.onFrame((f) => a.push(f));
		host.transport.onFrame((f) => b.push(f));
		const client = new WebSocket(`ws://127.0.0.1:${host.port}`);
		client.on("error", () => {});
		await once(client, "open");
		client.send(Uint8Array.from([1, 2, 3]));
		await new Promise((r) => setTimeout(r, 30));
		expect(a.length).toBe(1);
		expect(b.length).toBe(1);
		client.close();
	});

	it("primaryLanIPv4 returns a non-loopback address or null", () => {
		const ip = primaryLanIPv4();
		expect(ip === null || (typeof ip === "string" && ip !== "127.0.0.1")).toBe(
			true,
		);
	});
});

type InterfacesMap = ReturnType<typeof networkInterfaces>;

function ip4(address: string, internal = false) {
	return {
		address,
		netmask: "255.255.255.0",
		family: "IPv4" as const,
		mac: "00:00:00:00:00:00",
		internal,
		cidr: `${address}/24`,
	};
}

describe("interface selectors", () => {
	const withTailscaleFirst: InterfacesMap = {
		lo0: [ip4("127.0.0.1", true)],
		utun4: [ip4("100.110.83.27")],
		en0: [ip4("192.168.1.20")],
	};

	it("pickTailscaleIPv4 returns the 100.64/10 address when present", () => {
		expect(pickTailscaleIPv4(withTailscaleFirst)).toBe("100.110.83.27");
	});

	it("pickTailscaleIPv4 returns null when no CGNAT interface exists", () => {
		expect(
			pickTailscaleIPv4({
				lo0: [ip4("127.0.0.1", true)],
				en0: [ip4("192.168.1.20")],
			}),
		).toBe(null);
	});

	it("pickPrimaryLanIPv4 skips 100.64/10 even when it enumerates first", () => {
		expect(pickPrimaryLanIPv4(withTailscaleFirst)).toBe("192.168.1.20");
	});

	it("pickPrimaryLanIPv4 returns null when only CGNAT/internal exist", () => {
		expect(
			pickPrimaryLanIPv4({
				lo0: [ip4("127.0.0.1", true)],
				utun4: [ip4("100.110.83.27")],
			}),
		).toBe(null);
	});

	it("treats the CGNAT range boundaries exactly (100.64.0.0/10)", () => {
		const lanSide = ["100.63.255.255", "100.128.0.0"];
		const tailscaleSide = ["100.64.0.0", "100.127.255.255"];
		for (const addr of lanSide) {
			expect(pickPrimaryLanIPv4({ en0: [ip4(addr)] })).toBe(addr);
			expect(pickTailscaleIPv4({ en0: [ip4(addr)] })).toBe(null);
		}
		for (const addr of tailscaleSide) {
			expect(pickPrimaryLanIPv4({ utun4: [ip4(addr)] })).toBe(null);
			expect(pickTailscaleIPv4({ utun4: [ip4(addr)] })).toBe(addr);
		}
	});
});
