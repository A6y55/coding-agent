import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import type { AuditLog } from "./audit.ts";
import type { VerbRegistry } from "./registry.ts";
import type { SidecarCallResult, SidecarClient } from "./sidecar.ts";
import type {
	JsonObject,
	JsonValue,
	RegistryVerb,
	VerbCallRequest,
	VerbCallResult,
	VerbImplementation,
} from "./types.ts";

export const APPROVAL_RISKS = new Set(["write-remote", "message", "purchase", "delete", "auth"]);

export type ApprovalHandler = (verb: RegistryVerb, input: JsonObject) => Promise<boolean>;

function asSidecarResult(value: JsonValue): SidecarCallResult {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Sidecar returned a non-object result");
	return value as unknown as SidecarCallResult;
}

function chooseImplementation(verb: RegistryVerb, backend?: string): VerbImplementation {
	const candidates = verb.implementations
		.filter((implementation) => !backend || implementation.id === backend || implementation.backend === backend)
		.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
	if (candidates.length === 0) throw new Error(`No implementation for ${verb.name} matches backend ${backend}`);
	return candidates[0];
}

export class VerbRuntime {
	constructor(
		private readonly cwd: string,
		private readonly registry: VerbRegistry,
		private readonly sidecar: SidecarClient,
		private readonly audit: AuditLog,
		private readonly approve: ApprovalHandler,
	) {}

	async call(request: VerbCallRequest, signal?: AbortSignal, attempt = 1): Promise<VerbCallResult> {
		const started = Date.now();
		const callId = randomUUID();
		const verb = this.registry.get(request.name, request.version);
		const implementation = chooseImplementation(verb, request.backend);
		let result: VerbCallResult;

		try {
			this.registry.validateInput(verb, request.input);
			if (APPROVAL_RISKS.has(verb.risk) && !(await this.approve(verb, request.input))) {
				result = {
					callId,
					verb: { name: verb.name, version: verb.version, implementation: implementation.id },
					status: "blocked",
					preconditions: [],
					postconditions: [],
					evidence: { urls: [], screenshots: [], domSnapshots: [], notes: [] },
					declaredSideEffects: verb.sideEffects,
					actualSideEffects: [],
					session: { profile: request.profile },
					attempts: attempt,
					durationMs: Date.now() - started,
					error: "Operation was not approved",
				};
			} else {
				const source = implementation.source
					? isAbsolute(implementation.source)
						? implementation.source
						: resolve(dirname(verb.manifestPath), implementation.source)
					: undefined;
				const sidecarResult = asSidecarResult(
					await this.sidecar.request(
						"call",
						({
							verb: { ...verb, manifestPath: verb.manifestPath },
							implementation: { ...implementation, source },
							input: request.input,
							context: {
								cwd: this.cwd,
								profile: request.profile ?? verb.auth.profile,
								evidenceDir: resolve(this.cwd, ".pi", "web-verbs", "evidence"),
							},
						} as unknown) as JsonValue,
						{ signal, timeoutMs: request.timeoutMs },
					),
				);
				this.registry.validateOutput(verb, sidecarResult.output);
				result = {
					callId,
					verb: { name: verb.name, version: verb.version, implementation: implementation.id },
					status: "succeeded",
					output: sidecarResult.output,
					preconditions: sidecarResult.preconditions,
					postconditions: sidecarResult.postconditions,
					evidence: sidecarResult.evidence,
					declaredSideEffects: verb.sideEffects,
					actualSideEffects: sidecarResult.actualSideEffects,
					session: sidecarResult.session,
					attempts: attempt,
					durationMs: Date.now() - started,
				};
			}
		} catch (error) {
			result = {
				callId,
				verb: { name: verb.name, version: verb.version, implementation: implementation.id },
				status: "failed",
				preconditions: [],
				postconditions: [],
				evidence: { urls: [], screenshots: [], domSnapshots: [], notes: [] },
				declaredSideEffects: verb.sideEffects,
				actualSideEffects: [],
				session: { profile: request.profile },
				attempts: attempt,
				durationMs: Date.now() - started,
				error: error instanceof Error ? error.message : String(error),
			};
		}

		await this.audit.append({
			timestamp: new Date().toISOString(),
			input: request.input,
			result: result as unknown as JsonValue,
		});
		return result;
	}
}
