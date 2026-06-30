// tests/unit/xbp/lan-websocket-transport.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { once } from "node:events";
import WebSocket from "ws";
import { createLanWebSocketHost, primaryLanIPv4 } from "../../../services/xbp/lan-websocket-transport";

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
    expect(ip === null || (typeof ip === "string" && ip !== "127.0.0.1")).toBe(true);
  });
});
