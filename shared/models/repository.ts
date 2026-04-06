export type Repository = {
	id: string;
	name: string;
	rootPath: string;
	// Populated on successful runtime loads via git config --local.
	// Null only when repo identity resolution fails or for backward compatibility.
	repoId: string | null;
};
