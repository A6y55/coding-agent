import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface StructuredItem {
	id?: string;
	title: string;
	status?: string;
	detail?: string;
	file?: string;
	line?: number;
}

interface StructuredOutputDetails {
	schemaVersion: "1.0";
	kind: "plan" | "test" | "code-review" | "tool" | "final";
	status: "success" | "partial" | "failed" | "blocked";
	summary: string;
	items: StructuredItem[];
	risks: string[];
	nextActions: string[];
}

const structuredOutputTool = defineTool({
	name: "structured_output",
	label: "Structured Output",
	description: "Return the final plan, test result, review, tool summary, or task status using the shared Coding Agent schema.",
	promptSnippet: "Emit a schema-constrained final result",
	promptGuidelines: [
		"Use structured_output as the last action when the result must be machine-readable.",
		"Distinguish verified results from partial or blocked work through the status field.",
	],
	parameters: Type.Object({
		schemaVersion: Type.Literal("1.0"),
		kind: Type.Union([
			Type.Literal("plan"),
			Type.Literal("test"),
			Type.Literal("code-review"),
			Type.Literal("tool"),
			Type.Literal("final"),
		]),
		status: Type.Union([
			Type.Literal("success"),
			Type.Literal("partial"),
			Type.Literal("failed"),
			Type.Literal("blocked"),
		]),
		summary: Type.String(),
		items: Type.Array(
			Type.Object({
				id: Type.Optional(Type.String()),
				title: Type.String(),
				status: Type.Optional(Type.String()),
				detail: Type.Optional(Type.String()),
				file: Type.Optional(Type.String()),
				line: Type.Optional(Type.Integer({ minimum: 1 })),
			}),
		),
		risks: Type.Array(Type.String()),
		nextActions: Type.Array(Type.String()),
	}),
	async execute(_toolCallId, params) {
		const details = params satisfies StructuredOutputDetails;
		return {
			content: [{ type: "text", text: `${params.kind}: ${params.status}\n${params.summary}` }],
			details,
			terminate: true,
		};
	},
	renderResult(result, _options, theme) {
		const details = result.details as StructuredOutputDetails | undefined;
		if (!details) return new Text("No structured result", 0, 0);
		const lines = [
			theme.fg("toolTitle", theme.bold(`${details.kind}: ${details.status}`)),
			theme.fg("text", details.summary),
			...details.items.map((item, index) => theme.fg("muted", `${index + 1}. ${item.title}`)),
		];
		return new Text(lines.join("\n"), 0, 0);
	},
});

export default function structuredOutputExtension(pi: ExtensionAPI): void {
	pi.registerTool(structuredOutputTool);
}
