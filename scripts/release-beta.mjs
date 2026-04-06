const BETA_BASE = "0.1.0";
const BETA_TAG_PATTERN = /^v0\.1\.0-beta\.(\d+)$/;

export function parseBetaTag(tag) {
	const match = BETA_TAG_PATTERN.exec(tag);
	if (!match) return null;
	return {
		tag,
		version: tag.slice(1),
		sequence: Number(match[1]),
	};
}

export function computeNextBetaVersion(tags) {
	const sequences = tags
		.map(parseBetaTag)
		.filter(Boolean)
		.map((entry) => entry.sequence);
	const nextSequence = sequences.length === 0 ? 1 : Math.max(...sequences) + 1;
	return `${BETA_BASE}-beta.${nextSequence}`;
}

/**
 * Returns the first beta tag pointing at HEAD that matches the pattern.
 * If multiple matching beta tags point at the same HEAD commit, returns the first one
 * found in the input array (deterministic based on git tag output order).
 */
export function findHeadBetaTag(tagsPointingAtHead) {
	return tagsPointingAtHead.find((tag) => parseBetaTag(tag) !== null) ?? null;
}
