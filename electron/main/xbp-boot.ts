import { XbpHostService } from "../../services/xbp/xbp-host-service.js";

type XbpHostServiceOptions = ConstructorParameters<typeof XbpHostService>[0];

/**
 * The SOLE XbpHostService construction site in the main process (spec D7).
 * index.ts supplies the options but must never call `new XbpHostService` itself.
 * Gating construction here — not just the UI — is what guarantees a disabled
 * build opens no LAN pairing listener: the listener only opens inside
 * XbpHostService.start(), which is unreachable without construction.
 */
export async function createXbpHostIfEnabled(deps: {
	enabled: boolean;
	options: XbpHostServiceOptions;
	onStartError?: (err: unknown) => void;
}): Promise<XbpHostService | null> {
	if (!deps.enabled) return null;
	const service = new XbpHostService(deps.options);
	try {
		await service.setEnabled(true);
	} catch (err) {
		deps.onStartError?.(err);
	}
	return service;
}
