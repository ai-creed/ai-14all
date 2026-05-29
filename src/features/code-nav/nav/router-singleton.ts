import type { NavRouter } from "./nav-router.js";

let instance: NavRouter | null = null;
let toast: ((msg: string) => void) | null = null;

export function setNavRouter(r: NavRouter | null): void {
	instance = r;
}

export function getNavRouter(): NavRouter | null {
	return instance;
}

export function setCodeNavToast(fn: ((msg: string) => void) | null): void {
	toast = fn;
}

export function getCodeNavToast(): ((msg: string) => void) | null {
	return toast;
}
