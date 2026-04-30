import type {
	AgentAttentionBridgeReply,
	AgentAttentionBridgeRequest,
} from "../../../../shared/contracts/agent-attention-bridge";
import { agentAttentionBridge } from "../../../lib/desktop-client";
import type { WorkspaceAction } from "../../workspace/logic/workspace-state";

type Deps = {
	dispatch: (action: WorkspaceAction) => void;
	bridge?: typeof agentAttentionBridge;
};

export function attachAgentAttentionBridge({ dispatch, bridge = agentAttentionBridge }: Deps): () => void {
	const dispose = bridge.onRequest((req: AgentAttentionBridgeRequest) => {
		dispatch({
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
		const reply: AgentAttentionBridgeReply = { id: req.id, ok: true };
		bridge.sendReply(reply);
	});
	bridge.sendReady();
	return () => {
		bridge.sendGoodbye();
		dispose();
	};
}
