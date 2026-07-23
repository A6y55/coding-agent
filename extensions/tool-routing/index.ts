import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WEB_VERB_TOOLS = ["web_verb_search", "web_verb_describe", "web_verb_call"];

export const CODING_AGENT_TOOL_ROUTING = `## Tool routing

- Use repository tools first for code and files already present in the task workspace.
- Use Context7 through its documented CLI workflow for current library, framework, SDK, API, and CLI documentation. Do not use MCP for documentation lookup.
- Use Web Verbs for open-web discovery and website operations. Do not route web search through Brave Search.
- Discover a suitable Verb with web_verb_search. Use web_verb_describe when its typed contract is not already available.
- For general web search, call web_verb_call with name "search.web". Pass a focused query, engine "auto", and a bounded max_results value.
- Use web_verb_program only for explicit multi-step website workflows with data dependencies, branches, retries, or checkpoints. A single search does not require a program.
- Treat search results as discovery leads. Inspect the returned URLs and prefer primary sources before making factual claims.
- In read-only planning or review work, call only read-risk Verbs such as search.web. Do not invoke Verbs with remote-write, message, purchase, delete, or auth side effects.`;

export default function toolRoutingExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event) => {
		const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
		if (!WEB_VERB_TOOLS.every((toolName) => availableTools.has(toolName))) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${CODING_AGENT_TOOL_ROUTING}`,
		};
	});
}
