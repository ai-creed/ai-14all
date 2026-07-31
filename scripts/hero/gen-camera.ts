export type Rect = { x: number; y: number; w: number; h: number };
export type CameraKeyframe = { t: number; rect: Rect };
export type ExecutedBeat = {
	beat: string;
	settle: number;
	hold: number;
	rect: Rect | null;
};

/** Breathing room added around a measured rect before it becomes a crop.
 * Exported so callers that reason about the RESULTING crop size (the
 * recorder's stage-A no-op-push-in check) derive it from the same number
 * this function applies, instead of hardcoding a copy that can drift. */
export const DEFAULT_MARGIN_FRAC = 0.06;

/** Grow `rect` to `aspect` around its center with margin, clamped to `frame`. */
export function normalizeRectToAspect(
	rect: Rect,
	frame: Rect,
	aspect: number,
	marginFrac = DEFAULT_MARGIN_FRAC,
): Rect {
	let w = rect.w * (1 + marginFrac);
	let h = rect.h * (1 + marginFrac);
	if (w / h < aspect) w = h * aspect;
	else h = w / aspect;
	w = Math.min(w, frame.w);
	h = Math.min(h, frame.h);
	if (w / h < aspect) h = w / aspect;
	else w = h * aspect;
	let x = rect.x + rect.w / 2 - w / 2;
	let y = rect.y + rect.h / 2 - h / 2;
	x = Math.max(0, Math.min(x, frame.w - w));
	y = Math.max(0, Math.min(y, frame.h - h));
	return { x, y, w, h };
}

export function keyframesFromBeats(
	beats: ExecutedBeat[],
	frame: Rect,
): CameraKeyframe[] {
	const aspect = 1600 / 844;
	return beats.flatMap((b) => {
		const rect = b.rect
			? normalizeRectToAspect(b.rect, frame, aspect)
			: { ...frame };
		return [
			{ t: b.settle, rect },
			{ t: b.settle + b.hold, rect },
		];
	});
}

/** Piecewise-smoothstep zoompan; interpolates view WIDTH; time base in/FPS. */
export function buildZoompanFilter(
	kf: CameraKeyframe[],
	opts: { iw: number; ih: number; ow: number; oh: number; fps: number },
): string {
	const vals = (pick: (r: Rect) => number) =>
		kf.map((k) => [k.t, pick(k.rect)] as const);
	const expr = (points: ReadonlyArray<readonly [number, number]>) => {
		const T = `(in/${opts.fps})`;
		let out = String(points[points.length - 1][1]);
		for (let i = points.length - 2; i >= 0; i--) {
			const [a, v0] = points[i];
			const [b, v1] = points[i + 1];
			let seg: string;
			if (v0 === v1) seg = String(v0);
			else if (b - a === 0) seg = String(v1);
			else {
				const e = `clip((${T}-${a})/(${b - a}),0,1)`;
				seg = `(${v0}+${v1 - v0}*${e}*${e}*(3-2*${e}))`;
			}
			out = `if(lt(${T},${b}),${seg},${out})`;
		}
		return out;
	};
	const w = expr(vals((r) => r.w));
	const x = expr(vals((r) => r.x));
	const y = expr(vals((r) => r.y));
	return `zoompan=z='${opts.iw}/(${w})':x='${x}':y='${y}':d=1:s=${opts.ow}x${opts.oh}:fps=${opts.fps},format=yuv420p`;
}
