import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AuditLog } from "../../src/audit.ts";
import { ProgramRunner } from "../../src/program.ts";
import { VerbRegistry } from "../../src/registry.ts";
import { VerbRuntime } from "../../src/runtime.ts";
import { SidecarClient } from "../../src/sidecar.ts";
import type { JsonObject, RiskLevel, VerbCallRequest, VerbProgram } from "../../src/types.ts";

const RiskSchema = Type.Union([
	Type.Literal("read"),
	Type.Literal("write-local"),
	Type.Literal("write-remote"),
	Type.Literal("message"),
	Type.Literal("purchase"),
	Type.Literal("delete"),
	Type.Literal("auth"),
]);

const JsonObjectSchema = Type.Record(Type.String(), Type.Unknown());

const ProgramStepSchema = Type.Object({
	id: Type.String(),
	verb: Type.String(),
	version: Type.Optional(Type.String()),
	input: JsonObjectSchema,
	backend: Type.Optional(Type.String()),
	profile: Type.Optional(Type.String()),
	when: Type.Optional(
		Type.Object({
			ref: Type.String(),
			operator: Type.Union([
				Type.Literal("exists"),
				Type.Literal("truthy"),
				Type.Literal("equals"),
				Type.Literal("not-equals"),
			]),
			value: Type.Optional(Type.Unknown()),
		}),
	),
	foreach: Type.Optional(Type.Object({ ref: Type.String(), maxItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) })),
	retry: Type.Optional(
		Type.Object({ maxAttempts: Type.Integer({ minimum: 1, maximum: 5 }), backoffMs: Type.Optional(Type.Integer({ minimum: 0 })) }),
	),
	onError: Type.Optional(Type.Union([Type.Literal("stop"), Type.Literal("continue")])),
	checkpoint: Type.Optional(Type.Boolean()),
});

function createRuntime(cwd: string, registry: VerbRegistry, sidecar: SidecarClient, ctx: ExtensionContext): VerbRuntime {
	return new VerbRuntime(cwd, registry, sidecar, new AuditLog(cwd), async (verb) => {
		if (!ctx.hasUI) return false;
		return ctx.ui.confirm(
			`Approve Web Verb ${verb.risk} operation?`,
			`${verb.name}@${verb.version}\nSites: ${verb.sites.join(", ") || "local"}\nSide effects: ${verb.sideEffects.join(", ") || "unspecified"}`,
		);
	});
}

export default function webVerbsExtension(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const registry = new VerbRegistry(cwd);
	const sidecar = new SidecarClient();

	pi.registerTool({
		name: "web_verb_search",
		label: "Search Web Verbs",
		description: "Search typed Web Verb metadata by task, site, data shape, and risk without loading full contracts.",
		parameters: Type.Object({
			task: Type.String(),
			sites: Type.Optional(Type.Array(Type.String())),
			riskLevels: Type.Optional(Type.Array(RiskSchema)),
			inputType: Type.Optional(Type.String()),
			outputType: Type.Optional(Type.String()),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
		}),
		async execute(_toolCallId, params) {
			const matches = registry.search({
				task: params.task,
				sites: params.sites,
				riskLevels: params.riskLevels as RiskLevel[] | undefined,
				inputType: params.inputType,
				outputType: params.outputType,
				limit: params.limit,
			}).map((verb) => ({
				name: verb.name,
				version: verb.version,
				description: verb.description,
				sites: verb.sites,
				risk: verb.risk,
				status: verb.status,
				testStatus: verb.tests.status,
			}));
			return { content: [{ type: "text", text: JSON.stringify(matches, null, 2) }], details: { matches } };
		},
	});

	pi.registerTool({
		name: "web_verb_describe",
		label: "Describe Web Verb",
		description: "Load one Web Verb's complete typed contract, implementation metadata, and test state.",
		parameters: Type.Object({ name: Type.String(), version: Type.Optional(Type.String()) }),
		async execute(_toolCallId, params) {
			const { manifestPath: _manifestPath, ...definition } = registry.get(params.name, params.version);
			return { content: [{ type: "text", text: JSON.stringify(definition, null, 2) }], details: definition };
		},
	});

	pi.registerTool({
		name: "web_verb_call",
		label: "Call Web Verb",
		description: "Validate and execute one typed Web Verb with permission checks, evidence, output validation, and audit logging.",
		parameters: Type.Object({
			name: Type.String(),
			version: Type.Optional(Type.String()),
			input: JsonObjectSchema,
			backend: Type.Optional(Type.String()),
			profile: Type.Optional(Type.String()),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const runtime = createRuntime(ctx.cwd, registry, sidecar, ctx);
			const result = await runtime.call(params as unknown as VerbCallRequest, signal);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
				isError: result.status === "failed",
			};
		},
	});

	pi.registerTool({
		name: "web_verb_program",
		label: "Run Web Verb Program",
		description: "Run an explicit typed workflow with references, conditions, bounded foreach loops, retries, checkpoints, and resume.",
		parameters: Type.Object({
			id: Type.String({ pattern: "^[a-zA-Z0-9._-]{1,100}$" }),
			input: Type.Optional(JsonObjectSchema),
			steps: Type.Array(ProgramStepSchema, { minItems: 1, maxItems: 100 }),
			resume: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const runtime = createRuntime(ctx.cwd, registry, sidecar, ctx);
			const runner = new ProgramRunner(ctx.cwd, runtime);
			const result = await runner.run(params as unknown as VerbProgram, signal);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
				isError: result.status === "failed",
			};
		},
	});

	pi.registerCommand("web-verbs", {
		description: "Show or reload the Web Verb registry",
		handler: async (args, ctx) => {
			if (args.trim() === "reload") await registry.reload();
			ctx.ui.notify(`${registry.list().length} Web Verbs loaded`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			await registry.reload();
			ctx.ui.setStatus("web-verbs", ctx.ui.theme.fg("accent", `verbs:${registry.list().length}`));
		} catch (error) {
			ctx.ui.notify(`Web Verb registry failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		await sidecar.close();
	});
}
