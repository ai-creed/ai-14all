// shared/contracts/note-bridge.ts

export const NOTE_BRIDGE_REQUEST = "mcp:note:request";
export const NOTE_BRIDGE_REPLY = "mcp:note:reply";
export const NOTE_BRIDGE_READY = "mcp:note:ready";
export const NOTE_BRIDGE_GOODBYE = "mcp:note:goodbye";

export type NoteBridgeRequest =
	| { id: string; op: "read"; worktreeId: string }
	| {
			id: string;
			op: "append";
			worktreeId: string;
			title: string;
			body: string;
	  };

export type NoteBridgeReplySuccessRead = {
	id: string;
	ok: true;
	op: "read";
	note: string;
};

export type NoteBridgeReplySuccessAppend = {
	id: string;
	ok: true;
	op: "append";
	note: string;
	appendedSection: string;
};

export type NoteBridgeReplyError = {
	id: string;
	ok: false;
	error: "no_session";
	message: string;
};

export type NoteBridgeReply =
	| NoteBridgeReplySuccessRead
	| NoteBridgeReplySuccessAppend
	| NoteBridgeReplyError;
