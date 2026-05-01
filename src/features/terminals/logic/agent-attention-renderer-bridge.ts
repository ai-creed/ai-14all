import type {
	AgentAttentionBridgeReply,
	AgentAttentionBridgeRequest,
} from "../../../../shared/contracts/agent-attention-bridge";
import { agentAttentionBridge } from "../../../lib/desktop-client";
import type { WorkspaceAction } from "../../workspace/logic/workspace-state";

type Deps = {
	dispatchToWorktree: (worktreeId: string, action: WorkspaceAction) => boolean;
	bridge?: typeof agentAttentionBridge;
};

export function attachAgentAttentionBridge({
	dispatchToWorktree,
	bridge = agentAttentionBridge,
}: Deps): () => void {
	const dispose = bridge.onRequest((req: AgentAttentionBridgeRequest) => {
		const found = dispatchToWorktree(req.worktreeId, {
			type: "session/reportAgentAttention",
			worktreeId: req.worktreeId,
			reason: {
				state: req.state,
				source: "mcp",
				summary: req.summary,
				nextAction: req.nextAction,
				reportedAt: req.reportedAt,
			},
		});
		const reply: AgentAttentionBridgeReply = found
			? { id: req.id, ok: true }
			: {
					id: req.id,
					ok: false,
					error: "renderer_not_ready",
					message: `no renderer session owns worktree ${req.worktreeId}`,
				};
		bridge.sendReply(reply);
	});
	bridge.sendReady();
	return () => {
		bridge.sendGoodbye();
		dispose();
	};
}
