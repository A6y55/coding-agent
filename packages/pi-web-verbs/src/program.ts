import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VerbRuntime } from "./runtime.ts";
import type { JsonObject, JsonValue, ProgramResult, ProgramStep, VerbCallResult, VerbProgram } from "./types.ts";

interface CheckpointState {
	programHash: string;
	nextStep: number;
	steps: Record<string, JsonValue>;
	updatedAt: string;
}

function getPath(root: JsonValue, path: string): JsonValue | undefined {
	const segments = path.match(/[^.[\]]+/g) ?? [];
	let current: JsonValue | undefined = root;
	for (const segment of segments) {
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index)) return undefined;
			current = current[index];
		} else if (current !== null && typeof current === "object") {
			current = current[segment];
		} else {
			return undefined;
		}
	}
	return current;
}

function resolveTemplate(value: JsonValue, state: JsonObject): JsonValue {
	if (Array.isArray(value)) return value.map((item) => resolveTemplate(item, state));
	if (value !== null && typeof value === "object") {
		const keys = Object.keys(value);
		if (keys.length === 1 && keys[0] === "$ref" && typeof value.$ref === "string") {
			const resolved = getPath(state, value.$ref);
			if (resolved === undefined) throw new Error(`Unresolved program reference: ${value.$ref}`);
			return resolved;
		}
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveTemplate(child, state)]));
	}
	return value;
}

function shouldRun(step: ProgramStep, state: JsonObject): boolean {
	if (!step.when) return true;
	const actual = getPath(state, step.when.ref);
	if (step.when.operator === "exists") return actual !== undefined;
	if (step.when.operator === "truthy") return Boolean(actual);
	const equal = JSON.stringify(actual) === JSON.stringify(step.when.value);
	return step.when.operator === "equals" ? equal : !equal;
}

function hashProgram(program: VerbProgram): string {
	return createHash("sha256").update(JSON.stringify({ ...program, resume: false })).digest("hex");
}

function resultValue(result: VerbCallResult): JsonValue {
	return {
		status: result.status,
		output: result.output ?? null,
		error: result.error ?? null,
		attempts: result.attempts,
		callId: result.callId,
	};
}

async function delay(milliseconds: number): Promise<void> {
	if (milliseconds <= 0) return;
	await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export class ProgramRunner {
	constructor(
		private readonly cwd: string,
		private readonly runtime: VerbRuntime,
	) {}

	async run(program: VerbProgram, signal?: AbortSignal): Promise<ProgramResult> {
		if (!/^[a-zA-Z0-9._-]{1,100}$/.test(program.id)) throw new Error("Program id contains unsafe characters");
		if (new Set(program.steps.map((step) => step.id)).size !== program.steps.length) {
			throw new Error("Program step ids must be unique");
		}
		const programHash = hashProgram(program);
		let nextStep = 0;
		let steps: Record<string, JsonValue> = {};

		if (program.resume) {
			const checkpoint = await this.readCheckpoint(program.id);
			if (checkpoint) {
				if (checkpoint.programHash !== programHash) throw new Error("Checkpoint does not match the supplied program");
				nextStep = checkpoint.nextStep;
				steps = checkpoint.steps;
			}
		}

		for (let index = nextStep; index < program.steps.length; index++) {
			if (signal?.aborted) throw new Error("Web Verb program aborted");
			const step = program.steps[index];
			const baseState: JsonObject = { input: program.input ?? {}, steps };
			if (!shouldRun(step, baseState)) {
				steps[step.id] = { status: "skipped" };
				await this.writeCheckpoint(program.id, { programHash, nextStep: index + 1, steps, updatedAt: new Date().toISOString() });
				continue;
			}

			try {
				if (step.foreach) {
					const collection = getPath(baseState, step.foreach.ref);
					if (!Array.isArray(collection)) throw new Error(`foreach reference is not an array: ${step.foreach.ref}`);
					const maxItems = Math.min(Math.max(step.foreach.maxItems ?? 50, 1), 100);
					if (collection.length > maxItems) throw new Error(`foreach has ${collection.length} items, above limit ${maxItems}`);
					const results: JsonValue[] = [];
					for (let itemIndex = 0; itemIndex < collection.length; itemIndex++) {
						const state: JsonObject = { ...baseState, item: collection[itemIndex], index: itemIndex };
						const result = await this.callWithRetry(step, resolveTemplate(step.input, state) as JsonObject, signal);
						results.push(resultValue(result));
						if (result.status !== "succeeded") throw new Error(result.error ?? `${step.verb} failed for item ${itemIndex}`);
					}
					steps[step.id] = { status: "completed", results };
				} else {
					const result = await this.callWithRetry(step, resolveTemplate(step.input, baseState) as JsonObject, signal);
					steps[step.id] = resultValue(result);
					if (result.status !== "succeeded") throw new Error(result.error ?? `${step.verb} failed`);
				}
			} catch (error) {
				if (!steps[step.id]) steps[step.id] = { status: "failed", error: error instanceof Error ? error.message : String(error) };
				await this.writeCheckpoint(program.id, { programHash, nextStep: index, steps, updatedAt: new Date().toISOString() });
				if (step.onError !== "continue") {
					return {
						programId: program.id,
						status: "failed",
						steps,
						nextStep: index,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}

			if (step.checkpoint !== false) {
				await this.writeCheckpoint(program.id, { programHash, nextStep: index + 1, steps, updatedAt: new Date().toISOString() });
			}
		}

		return { programId: program.id, status: "succeeded", steps, nextStep: program.steps.length };
	}

	private async callWithRetry(step: ProgramStep, input: JsonObject, signal?: AbortSignal): Promise<VerbCallResult> {
		const maxAttempts = Math.min(Math.max(step.retry?.maxAttempts ?? 1, 1), 5);
		let result: VerbCallResult | undefined;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			result = await this.runtime.call(
				{ name: step.verb, version: step.version, input, backend: step.backend, profile: step.profile },
				signal,
				attempt,
			);
			if (result.status === "succeeded" || result.status === "blocked") return result;
			if (attempt < maxAttempts) await delay(step.retry?.backoffMs ?? 250);
		}
		if (!result) throw new Error("Web Verb call did not execute");
		return result;
	}

	private checkpointPath(id: string): string {
		return join(this.cwd, ".pi", "web-verbs", "checkpoints", `${id}.json`);
	}

	private async readCheckpoint(id: string): Promise<CheckpointState | undefined> {
		try {
			return JSON.parse(await readFile(this.checkpointPath(id), "utf8")) as CheckpointState;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}

	private async writeCheckpoint(id: string, state: CheckpointState): Promise<void> {
		const path = this.checkpointPath(id);
		await mkdir(join(this.cwd, ".pi", "web-verbs", "checkpoints"), { recursive: true });
		const temporary = `${path}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await rename(temporary, path);
	}
}
