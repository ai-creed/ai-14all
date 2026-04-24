import { describe, expect, it } from "vitest";
import { WorkspaceRegistryService } from "../../../../services/workspace/workspace-registry-service";

describe("WorkspaceRegistryService", () => {
	it("reuses the same workspace id when the same repository is opened twice", () => {
		const service = new WorkspaceRegistryService();
		const first = service.register({
			workspaceId: "ws-repo-id-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: "repo-id-1",
			},
		});
		const second = service.register({
			workspaceId: "ws-ignored",
			repository: {
				id: "repo-1b",
				name: "repo",
				rootPath: "/repo",
				repoId: "repo-id-1",
			},
		});

		expect(second.workspaceId).toBe(first.workspaceId);
	});

	it("reuses the same workspace id when the same rootPath matches but repoId is absent", () => {
		const service = new WorkspaceRegistryService();
		const first = service.register({
			workspaceId: "ws-path-1",
			repository: {
				id: "repo-1",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});
		const second = service.register({
			workspaceId: "ws-ignored",
			repository: {
				id: "repo-1b",
				name: "repo",
				rootPath: "/repo",
				repoId: null,
			},
		});

		expect(second.workspaceId).toBe(first.workspaceId);
	});
});
