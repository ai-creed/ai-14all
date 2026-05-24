export type Orientation = "vertical" | "horizontal" | "none";
export type Distribution =
	| "single"
	| "equal"
	| "master"
	| "double-master"
	| "grid";

export type LayoutId =
	| "1"
	| "2-v"
	| "2-h"
	| "3-v"
	| "3-h"
	| "3-vm"
	| "3-hm"
	| "4-v"
	| "4-h"
	| "4-vm"
	| "4-hm"
	| "4-grid"
	| "5-v"
	| "5-h"
	| "5-vm"
	| "5-hm"
	| "5-vdm"
	| "5-hdm"
	| "6-v"
	| "6-h"
	| "6-vm"
	| "6-hm"
	| "6-vdm"
	| "6-hdm"
	| "6-grid23"
	| "6-grid32";

export interface LayoutDescriptor {
	id: LayoutId;
	slotCount: number;
	orientation: Orientation;
	distribution: Distribution;
	masterSlots: number;
	gridTemplateColumns: string;
	gridTemplateRows: string;
	slotPlacements: { gridColumn: string; gridRow: string }[];
}
