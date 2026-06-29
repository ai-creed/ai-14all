import type { ReviewCommentStatus } from "../../../../shared/models/review-comment";

export type Dot = { id: string; position: number; status: ReviewCommentStatus };
export type DotCluster = { position: number; items: Dot[] };

export function clusterDots(dots: Dot[], threshold: number): DotCluster[] {
	const sorted = [...dots].sort((a, b) => a.position - b.position);
	const clusters: DotCluster[] = [];
	for (const dot of sorted) {
		const last = clusters[clusters.length - 1];
		if (
			last &&
			dot.position - last.items[last.items.length - 1]!.position <= threshold
		) {
			last.items.push(dot);
			last.position =
				last.items.reduce((sum, i) => sum + i.position, 0) / last.items.length;
		} else {
			clusters.push({ position: dot.position, items: [dot] });
		}
	}
	return clusters;
}
