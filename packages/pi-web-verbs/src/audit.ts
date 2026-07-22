import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { JsonValue } from "./types.ts";

const SECRET_KEY = /(password|passwd|secret|token|cookie|authorization|api[-_]?key)/i;

function redact(value: JsonValue, key?: string): JsonValue {
	if (key && SECRET_KEY.test(key)) return "[REDACTED]";
	if (Array.isArray(value)) return value.map((item) => redact(item));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
	}
	return value;
}

export class AuditLog {
	constructor(private readonly cwd: string) {}

	async append(record: Record<string, JsonValue>): Promise<void> {
		const directory = join(this.cwd, ".pi", "web-verbs", "audit");
		await mkdir(directory, { recursive: true });
		const date = new Date().toISOString().slice(0, 10);
		const handle = await open(join(directory, `${date}.jsonl`), "a", 0o600);
		try {
			await handle.writeFile(`${JSON.stringify(redact(record))}\n`, "utf8");
		} finally {
			await handle.close();
		}
	}
}
