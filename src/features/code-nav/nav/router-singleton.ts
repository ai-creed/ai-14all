import type { NavRouter } from "./nav-router.js";
import type { ModelProvisioner } from "../monaco/model-provisioner.js";

let instance: NavRouter | null = null;
let toast: ((msg: string) => void) | null = null;
let provisioner: ModelProvisioner | null = null;

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

export function setModelProvisioner(p: ModelProvisioner | null): void {
	provisioner = p;
}

export function getModelProvisioner(): ModelProvisioner | null {
	return provisioner;
}
