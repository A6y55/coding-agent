export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const RISK_LEVELS = ["read", "write-local", "write-remote", "message", "purchase", "delete", "auth"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface ContractCondition {
	id: string;
	description: string;
	kind: "url-matches" | "selector-exists" | "custom";
	value?: string;
}

export interface VerbImplementation {
	id: string;
	backend: "python" | "browser";
	module?: string;
	source?: string;
	function: string;
	requestClass?: string;
	responseClass?: string;
	priority?: number;
}

export interface VerbDefinition {
	schemaVersion: "1.0";
	name: string;
	version: string;
	description: string;
	tags: string[];
	sites: string[];
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
	preconditions: ContractCondition[];
	postconditions: ContractCondition[];
	auth: { required: boolean; profile?: string; scopes?: string[] };
	risk: RiskLevel;
	sideEffects: string[];
	implementations: VerbImplementation[];
	status: "experimental" | "tested" | "active" | "disabled";
	tests: { status: "unknown" | "passing" | "failing"; lastRun?: string; revision?: string };
}

export interface RegistryVerb extends VerbDefinition {
	manifestPath: string;
}

export interface CheckResult {
	id: string;
	passed: boolean;
	detail?: string;
}

export interface VerbEvidence {
	urls: string[];
	screenshots: string[];
	domSnapshots: string[];
	notes: string[];
}

export interface VerbCallResult {
	callId: string;
	verb: { name: string; version: string; implementation: string };
	status: "succeeded" | "failed" | "blocked";
	output?: JsonValue;
	preconditions: CheckResult[];
	postconditions: CheckResult[];
	evidence: VerbEvidence;
	declaredSideEffects: string[];
	actualSideEffects: string[];
	session: { id?: string; profile?: string };
	attempts: number;
	durationMs: number;
	error?: string;
}

export interface VerbCallRequest {
	name: string;
	version?: string;
	input: JsonObject;
	backend?: string;
	profile?: string;
	timeoutMs?: number;
}

export interface ProgramCondition {
	ref: string;
	operator: "exists" | "truthy" | "equals" | "not-equals";
	value?: JsonValue;
}

export interface ProgramStep {
	id: string;
	verb: string;
	version?: string;
	input: JsonObject;
	backend?: string;
	profile?: string;
	when?: ProgramCondition;
	foreach?: { ref: string; maxItems?: number };
	retry?: { maxAttempts: number; backoffMs?: number };
	onError?: "stop" | "continue";
	checkpoint?: boolean;
}

export interface VerbProgram {
	id: string;
	input?: JsonObject;
	steps: ProgramStep[];
	resume?: boolean;
}

export interface ProgramResult {
	programId: string;
	status: "succeeded" | "failed";
	steps: Record<string, JsonValue>;
	nextStep: number;
	error?: string;
}
