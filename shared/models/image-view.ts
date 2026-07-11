export type ImageReadFailure =
	| { kind: "not-found" }
	| { kind: "permission-denied" }
	| { kind: "read-failed" }
	| { kind: "path-escape" }
	| { kind: "too-large"; size: number }
	| { kind: "not-image" };

export type ImageReadResult =
	| { ok: true; base64: string; mime: string; byteLength: number }
	| { ok: false; reason: ImageReadFailure };
