export const SUPPORTED_SCHEMA = { major: 3, minMinor: 1 } as const;

/**
 * Binding v3.1 reader rule: pin to the major, accept any minor at or above the
 * one we were written against. Decided in exactly one place; all callers delegate.
 */
export function isSupportedSchemaVersion(v: string): boolean {
	const parts = v.split(".");
	// Cortex's content version is exactly `major.minor`. Anything else
	// (empty, "3", "3.x", "3.1.0") is malformed and rejected.
	if (parts.length !== 2) return false;
	const major = Number(parts[0]);
	const minor = Number(parts[1]);
	if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;
	return major === SUPPORTED_SCHEMA.major && minor >= SUPPORTED_SCHEMA.minMinor;
}
