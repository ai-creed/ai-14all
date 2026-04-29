export type ReviewLoadState<T> = {
	data: T | null;
	stale: boolean;
	message: string | null;
};
