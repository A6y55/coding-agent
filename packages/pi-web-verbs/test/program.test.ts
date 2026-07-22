import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProgramRunner } from "../src/program.ts";
import type { VerbRuntime } from "../src/runtime.ts";
import type { VerbCallRequest, VerbCallResult } from "../src/types.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function success(request: VerbCallRequest, output: VerbCallResult["output"], attempt: number): VerbCallResult {
	return {
		callId: `${request.name}-${attempt}`,
		verb: { name: request.name, version: request.version ?? "1.0.0", implementation: "test" },
		status: "succeeded",
		output,
		preconditions: [],
		postconditions: [],
		evidence: { urls: [], screenshots: [], domSnapshots: [], notes: [] },
		declaredSideEffects: [],
		actualSideEffects: [],
		session: {},
		attempts: attempt,
		durationMs: 1,
	};
}

describe("ProgramRunner", () => {
	it("resolves data dependencies and bounded loops", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-web-verbs-program-"));
		temporaryDirectories.push(cwd);
		const calls: VerbCallRequest[] = [];
		const runtime = {
			async call(request: VerbCallRequest, _signal: AbortSignal | undefined, attempt: number) {
				calls.push(request);
				if (request.name === "seed") return success(request, { items: ["a", "b"] }, attempt);
				return success(request, request.input, attempt);
			},
		} as unknown as VerbRuntime;
		const runner = new ProgramRunner(cwd, runtime);

		const result = await runner.run({
			id: "references-and-loop",
			steps: [
				{ id: "seed", verb: "seed", input: {} },
				{
					id: "each",
					verb: "echo",
					input: { message: { $ref: "item" } },
					foreach: { ref: "steps.seed.output.items", maxItems: 2 },
				},
			],
		});

		expect(result.status).toBe("succeeded");
		expect(calls.map((call) => call.input)).toEqual([{}, { message: "a" }, { message: "b" }]);
	});
});
