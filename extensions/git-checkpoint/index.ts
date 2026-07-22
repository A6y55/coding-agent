import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createGitCheckpoint, type GitCheckpoint, restoreGitCheckpoint } from "../../src/git-checkpoint.ts";

const MAX_CHECKPOINTS = 50;

export default function gitCheckpointExtension(pi: ExtensionAPI): void {
	let checkpoints: GitCheckpoint[] = [];
	let lastTree: string | undefined;

	function remember(checkpoint: GitCheckpoint): void {
		if (checkpoint.tree === lastTree) return;
		lastTree = checkpoint.tree;
		checkpoints.push(checkpoint);
		checkpoints = checkpoints.slice(-MAX_CHECKPOINTS);
		pi.appendEntry("git-checkpoint", checkpoint);
	}

	async function capture(reason: string, ctx?: ExtensionContext): Promise<GitCheckpoint | undefined> {
		try {
			const checkpoint = await createGitCheckpoint(ctx?.cwd ?? process.cwd(), reason);
			if (checkpoint) remember(checkpoint);
			return checkpoint;
		} catch (error) {
			ctx?.ui.notify(`Git checkpoint failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			return undefined;
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		checkpoints = ctx.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "git-checkpoint")
			.map((entry) => (entry as { data?: GitCheckpoint }).data)
			.filter((checkpoint): checkpoint is GitCheckpoint => checkpoint !== undefined)
			.slice(-MAX_CHECKPOINTS);
		lastTree = checkpoints.at(-1)?.tree;
	});

	pi.on("turn_start", async (_event, ctx) => {
		await capture("turn start", ctx);
	});

	pi.registerTool({
		name: "git_checkpoint",
		label: "Git Checkpoint",
		description: "Create, list, or explicitly restore Pi Git checkpoints. Restore always requires interactive approval.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("restore")]),
			reason: Type.Optional(Type.String()),
			id: Type.Optional(Type.String({ description: "Checkpoint id or full Git object id for restore" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.action === "create") {
				const checkpoint = await capture(params.reason ?? "explicit tool request", ctx);
				if (!checkpoint) throw new Error("No Git repository was found or checkpoint creation failed");
				return { content: [{ type: "text", text: `Created checkpoint ${checkpoint.id}` }], details: checkpoint };
			}

			if (params.action === "list") {
				const summary = checkpoints.map((item) => `${item.id} ${item.createdAt} ${item.reason}`).join("\n") || "No checkpoints";
				return { content: [{ type: "text", text: summary }], details: { checkpoints } };
			}

			const checkpoint = checkpoints.find((item) => item.id === params.id || item.ref === params.id);
			if (!checkpoint) throw new Error(`Unknown checkpoint: ${params.id ?? "(missing id)"}`);
			if (!ctx.hasUI) throw new Error("Checkpoint restore is blocked without an interactive approval UI");
			const approved = await ctx.ui.confirm(
				"Restore Git checkpoint?",
				`Restore tracked files and the index from ${checkpoint.id}? New untracked files are not deleted.`,
			);
			if (!approved) throw new Error("Checkpoint restore was not approved");

			await capture(`before restoring ${checkpoint.id}`, ctx);
			await restoreGitCheckpoint(ctx.cwd, checkpoint);
			return {
				content: [{ type: "text", text: `Restored tracked files from checkpoint ${checkpoint.id}` }],
				details: checkpoint,
			};
		},
	});
}
