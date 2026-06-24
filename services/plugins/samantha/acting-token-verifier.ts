import { timingSafeEqual } from "node:crypto";

export type ActingTokenVerifier = {
	verify(token: string | undefined): boolean;
};

/**
 * Verifies the registration token presented on an acting command against a
 * shared secret. Default-deny: no secret configured, or an absent/empty/
 * mismatched token, all return false. Constant-time comparison avoids leaking
 * secret length/content via timing.
 */
export function createActingTokenVerifier(deps: {
	readSecret: () => string | null;
}): ActingTokenVerifier {
	return {
		verify(token) {
			const secret = deps.readSecret();
			if (secret === null || secret.length === 0) return false;
			if (token === undefined || token.length === 0) return false;
			const a = Buffer.from(token, "utf8");
			const b = Buffer.from(secret, "utf8");
			if (a.length !== b.length) return false;
			return timingSafeEqual(a, b);
		},
	};
}
