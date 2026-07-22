import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createGitCheckpoint, type GitCheckpoint, restoreGitCheckpoint } from "../../src/git-checkpoint.ts";

export default function runtimeReloadExtension(pi: ExtensionAPI): void {
	pi.registerCommand("reload-runtime", {
		description: "Create a Git checkpoint, then reload extensions and resources",
		handler: async (_args, ctx) => {
			const checkpoint = await createGitCheckpoint(ctx.cwd, "before runtime reload");
			if (checkpoint) pi.appendEntry("git-checkpoint", checkpoint);
			await ctx.reload();
			return;
		},
	});

	pi.registerCommand("rollback-runtime", {
		description: "Restore the latest pre-reload Git checkpoint, then reload again",
		handler: async (_args, ctx) => {
			const checkpoint = ctx.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === "git-checkpoint")
				.map((entry) => (entry as { data?: GitCheckpoint }).data)
				.filter((item): item is GitCheckpoint => item?.reason === "before runtime reload")
				.at(-1);
			if (!checkpoint) {
				ctx.ui.notify("No pre-reload checkpoint is available", "warning");
				return;
			}
			if (!ctx.hasUI) throw new Error("Runtime rollback requires interactive approval");
			const approved = await ctx.ui.confirm(
				"Rollback runtime changes?",
				`Restore tracked files and the index from ${checkpoint.id}, then reload extensions?`,
			);
			if (!approved) return;
			const backup = await createGitCheckpoint(ctx.cwd, `before runtime rollback to ${checkpoint.id}`);
			if (backup) pi.appendEntry("git-checkpoint", backup);
			await restoreGitCheckpoint(ctx.cwd, checkpoint);
			await ctx.reload();
			return;
		},
	});

	pi.registerTool({
		name: "reload_runtime",
		label: "Reload Runtime",
		description: "Queue a checkpointed reload after extension code or runtime resources change",
		parameters: Type.Object({}),
		async execute() {
			pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
			return {
				content: [{ type: "text", text: "Queued checkpointed runtime reload." }],
				details: { queued: true },
			};
		},
	});

	pi.registerTool({
		name: "rollback_runtime",
		label: "Rollback Runtime",
		description: "Queue an approved rollback to the latest checkpoint created before runtime reload",
		parameters: Type.Object({}),
		async execute() {
			pi.sendUserMessage("/rollback-runtime", { deliverAs: "followUp" });
			return {
				content: [{ type: "text", text: "Queued interactive runtime rollback." }],
				details: { queued: true },
			};
		},
	});
}
