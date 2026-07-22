import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface RiskMatch {
	category: string;
	detail: string;
}

const COMMAND_RULES: Array<{ category: string; pattern: RegExp }> = [
	{ category: "delete", pattern: /(^|[;&|]\s*)\s*(rm|rmdir)\b/i },
	{ category: "privilege escalation", pattern: /(^|[;&|]\s*)\s*(sudo|su)\b/i },
	{ category: "permission change", pattern: /\b(chmod|chown|chgrp)\b/i },
	{ category: "destructive Git operation", pattern: /\bgit\s+(reset\s+--hard|clean\s+-|push\b.*--force)/i },
	{ category: "remote publish", pattern: /\b(npm\s+publish|twine\s+upload|docker\s+push|git\s+push)\b/i },
	{ category: "system control", pattern: /\b(reboot|shutdown|systemctl\s+(stop|restart|disable))\b/i },
];

const REMOTE_READ_ONLY_COMMAND =
	/^\s*(cat|head|tail|less|more|grep|rg|find|fd|ls|pwd|wc|file|stat|du|df|tree|which|whereis|type|env|printenv|uname|whoami|id|date|uptime|ps|git\s+(status|log|diff|show|branch))\b[^;&|>]*$/i;

const SIDE_EFFECT_TOOL = /(^|_)(send|email|message|post|publish|purchase|checkout|delete|authorize|grant)(_|$)/i;

function classify(toolName: string, input: Record<string, unknown>, sshTarget: unknown): RiskMatch | undefined {
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		const rule = COMMAND_RULES.find((candidate) => candidate.pattern.test(command));
		if (rule) return { category: rule.category, detail: command };
		if (typeof sshTarget === "string" && sshTarget.length > 0 && !REMOTE_READ_ONLY_COMMAND.test(command)) {
			return { category: "remote command with possible side effects", detail: `${sshTarget}: ${command}` };
		}
	}

	if ((toolName === "write" || toolName === "edit") && typeof sshTarget === "string" && sshTarget.length > 0) {
		const target = typeof input.path === "string" ? input.path : typeof input.file_path === "string" ? input.file_path : "file";
		return { category: "remote write", detail: `${sshTarget}:${target}` };
	}

	if (SIDE_EFFECT_TOOL.test(toolName) && !toolName.startsWith("web_verb_")) {
		return { category: "external side effect", detail: `${toolName}\n${JSON.stringify(input, null, 2)}` };
	}

	return undefined;
}

export default function permissionGateExtension(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		const risk = classify(event.toolName, event.input, pi.getFlag("ssh"));
		if (!risk) return;

		if (!ctx.hasUI) {
			return { block: true, reason: `${risk.category} blocked because no interactive approval UI is available` };
		}

		const approved = await ctx.ui.confirm(`Approve ${risk.category}?`, risk.detail);
		if (!approved) return { block: true, reason: `${risk.category} was not approved` };
	});
}
