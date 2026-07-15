import { beforeEach, describe, expect, it, vi } from "vitest";
import { XbpHostService } from "../../../services/xbp/xbp-host-service.js";
import { createXbpHostIfEnabled } from "../../../electron/main/xbp-boot";

vi.mock("../../../services/xbp/xbp-host-service.js", () => ({
	XbpHostService: vi.fn(),
}));

const MockXbpHostService = vi.mocked(XbpHostService);
type Options = ConstructorParameters<typeof XbpHostService>[0];

function fakeService(setEnabledImpl?: () => Promise<void>) {
	return { setEnabled: vi.fn(setEnabledImpl ?? (async () => {})) };
}

beforeEach(() => {
	MockXbpHostService.mockReset();
});

describe("createXbpHostIfEnabled", () => {
	it("does NOT construct the service (and opens no LAN listener) when disabled", async () => {
		const result = await createXbpHostIfEnabled({
			enabled: false,
			options: {} as Options,
		});
		expect(MockXbpHostService).not.toHaveBeenCalled();
		expect(result).toBeNull();
	});

	it("constructs exactly once with the options and awaits setEnabled(true) when enabled", async () => {
		const svc = fakeService();
		MockXbpHostService.mockImplementation(function () {
			return svc as unknown as XbpHostService;
		});
		const options = { dir: "/tmp/xbp" } as unknown as Options;
		const result = await createXbpHostIfEnabled({ enabled: true, options });
		expect(MockXbpHostService).toHaveBeenCalledTimes(1);
		expect(MockXbpHostService).toHaveBeenCalledWith(options);
		expect(svc.setEnabled).toHaveBeenCalledTimes(1);
		expect(svc.setEnabled).toHaveBeenCalledWith(true);
		expect(result).toBe(svc);
	});

	it("routes a setEnabled(true) failure to onStartError and still returns the service", async () => {
		const boom = new Error("bind failed");
		const svc = fakeService(async () => {
			throw boom;
		});
		MockXbpHostService.mockImplementation(function () {
			return svc as unknown as XbpHostService;
		});
		const onStartError = vi.fn();
		const result = await createXbpHostIfEnabled({
			enabled: true,
			options: {} as Options,
			onStartError,
		});
		expect(onStartError).toHaveBeenCalledWith(boom);
		expect(result).toBe(svc);
	});
});
