import { readdir, readFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { RISK_LEVELS, type JsonObject, type JsonValue, type RegistryVerb, type RiskLevel, type VerbDefinition } from "./types.ts";

const MANIFEST_SCHEMA = {
	type: "object",
	required: [
		"schemaVersion",
		"name",
		"version",
		"description",
		"tags",
		"sites",
		"inputSchema",
		"outputSchema",
		"preconditions",
		"postconditions",
		"auth",
		"risk",
		"sideEffects",
		"implementations",
		"status",
		"tests",
	],
	properties: {
		schemaVersion: { const: "1.0" },
		name: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]+$" },
		version: { type: "string", minLength: 1 },
		description: { type: "string", minLength: 1 },
		tags: { type: "array", items: { type: "string" } },
		sites: { type: "array", items: { type: "string" } },
		inputSchema: { type: "object" },
		outputSchema: { type: "object" },
		preconditions: { type: "array" },
		postconditions: { type: "array" },
		auth: { type: "object", required: ["required"] },
		risk: { enum: RISK_LEVELS },
		sideEffects: { type: "array", items: { type: "string" } },
		implementations: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				required: ["id", "backend", "function"],
				properties: { backend: { enum: ["python", "browser"] } },
			},
		},
		status: { enum: ["experimental", "tested", "active", "disabled"] },
		tests: { type: "object", required: ["status"] },
	},
} as const;

function formatErrors(errors: ErrorObject[] | null | undefined): string {
	return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`).join("; ");
}

async function findJsonFiles(root: string): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(root, entry.name);
			if (entry.isDirectory()) return findJsonFiles(path);
			return Promise.resolve(entry.isFile() && entry.name.endsWith(".json") ? [path] : []);
		}),
	);
	return nested.flat();
}

function compareVersions(left: string, right: string): number {
	return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export class VerbRegistry {
	private readonly ajv = new Ajv({ allErrors: true, strict: false });
	private readonly validateManifest = this.ajv.compile(MANIFEST_SCHEMA);
	private readonly validators = new Map<string, ValidateFunction>();
	private verbs: RegistryVerb[] = [];

	constructor(
		private readonly cwd: string,
		private readonly packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	) {}

	async reload(): Promise<void> {
		const configured = (process.env.PI_WEB_VERBS_PATH ?? "")
			.split(delimiter)
			.map((item) => item.trim())
			.filter(Boolean);
		const roots = [join(this.packageRoot, "verbs"), join(this.cwd, ".pi", "web-verbs", "verbs"), ...configured];
		const files = (await Promise.all(roots.map(findJsonFiles))).flat();
		const loaded: RegistryVerb[] = [];

		for (const manifestPath of files) {
			const value: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
			if (!this.validateManifest(value)) {
				throw new Error(`Invalid Web Verb manifest ${manifestPath}: ${formatErrors(this.validateManifest.errors)}`);
			}
			const verb = value as VerbDefinition;
			this.ajv.compile(verb.inputSchema);
			this.ajv.compile(verb.outputSchema);
			loaded.push({ ...verb, manifestPath });
		}

		this.verbs = loaded
			.filter((verb) => verb.status !== "disabled")
			.sort((left, right) => left.name.localeCompare(right.name) || compareVersions(right.version, left.version));
		this.validators.clear();
	}

	list(): RegistryVerb[] {
		return [...this.verbs];
	}

	get(name: string, version?: string): RegistryVerb {
		const candidates = this.verbs.filter((verb) => verb.name === name && (!version || verb.version === version));
		if (candidates.length === 0) throw new Error(`Unknown Web Verb ${name}${version ? `@${version}` : ""}`);
		return candidates[0];
	}

	search(query: {
		task: string;
		sites?: string[];
		riskLevels?: RiskLevel[];
		inputType?: string;
		outputType?: string;
		limit?: number;
	}): RegistryVerb[] {
		const tokens = query.task.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
		return this.verbs
			.filter((verb) => !query.riskLevels || query.riskLevels.includes(verb.risk))
			.filter((verb) => !query.sites?.length || query.sites.some((site) => verb.sites.some((candidate) => candidate.includes(site))))
			.map((verb) => {
				const haystack = [verb.name, verb.description, ...verb.tags, ...verb.sites].join(" ").toLowerCase();
				let score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 2 : 0), 0);
				if (query.inputType && JSON.stringify(verb.inputSchema).includes(query.inputType)) score += 1;
				if (query.outputType && JSON.stringify(verb.outputSchema).includes(query.outputType)) score += 1;
				return { verb, score };
			})
			.filter((item) => tokens.length === 0 || item.score > 0)
			.sort((left, right) => right.score - left.score || left.verb.name.localeCompare(right.verb.name))
			.slice(0, Math.min(Math.max(query.limit ?? 5, 1), 20))
			.map((item) => item.verb);
	}

	validateInput(verb: RegistryVerb, input: JsonObject): void {
		this.validate(`${verb.name}@${verb.version}:input`, verb.inputSchema, input);
	}

	validateOutput(verb: RegistryVerb, output: JsonValue): void {
		this.validate(`${verb.name}@${verb.version}:output`, verb.outputSchema, output);
	}

	private validate(key: string, schema: Record<string, unknown>, value: unknown): void {
		const validator = this.validators.get(key) ?? this.ajv.compile(schema);
		this.validators.set(key, validator);
		if (!validator(value)) throw new Error(`Schema validation failed: ${formatErrors(validator.errors)}`);
	}
}
