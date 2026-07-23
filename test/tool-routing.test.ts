import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import toolRoutingExtension from "../extensions/tool-routing/index.ts";

type BeforeAgentStartHandler = (event: { systemPrompt: string }) => Promise<{ systemPrompt: string } | undefined>;

function registerRouting(toolNames: string[]): BeforeAgentStartHandler {
	let handler: BeforeAgentStartHandler | undefined;
	const pi = {
		getAllTools: () => toolNames.map((name) => ({ name })),
		on: (eventName: string, eventHandler: BeforeAgentStartHandler) => {
			if (eventName === "before_agent_start") handler = eventHandler;
		},
	} as unknown as ExtensionAPI;

	toolRoutingExtension(pi);
	if (!handler) throw new Error("before_agent_start handler was not registered");
	return handler;
}

describe("tool routing", () => {
	it("adds the local Coding Agent route when Web Verb tools are available", async () => {
		const handler = registerRouting(["web_verb_search", "web_verb_describe", "web_verb_call"]);
		const result = await handler({ systemPrompt: "base prompt" });

		expect(result?.systemPrompt).toContain("base prompt");
		expect(result?.systemPrompt).toContain("Context7");
		expect(result?.systemPrompt).toContain("web_verb_search");
		expect(result?.systemPrompt).toContain('name "search.web"');
		expect(result?.systemPrompt).not.toContain("Brave Search API");
	});

	it("does not inject an unusable route when Web Verb tools are absent", async () => {
		const handler = registerRouting(["read", "bash"]);
		const result = await handler({ systemPrompt: "base prompt" });

		expect(result).toBeUndefined();
	});
});
