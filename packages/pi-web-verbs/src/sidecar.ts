import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckResult, JsonValue, VerbEvidence } from "./types.ts";

export interface SidecarCallResult {
	output: JsonValue;
	preconditions: CheckResult[];
	postconditions: CheckResult[];
	evidence: VerbEvidence;
	actualSideEffects: string[];
	session: { id?: string; profile?: string };
}

interface PendingRequest {
	resolve: (value: JsonValue) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
	cleanupAbort?: () => void;
}

interface RpcResponse {
	id: string;
	result?: JsonValue;
	error?: { message?: string };
}

export class SidecarClient {
	private child?: ChildProcessWithoutNullStreams;
	private buffer = "";
	private readonly pending = new Map<string, PendingRequest>();
	private stderr = "";

	constructor(
		private readonly packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
		private readonly python = process.env.PI_WEB_VERBS_PYTHON ?? "python3",
	) {}

	async request(method: string, params: JsonValue, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<JsonValue> {
		const child = this.ensureProcess();
		const id = randomUUID();
		const timeoutMs = Math.min(Math.max(options?.timeoutMs ?? 120_000, 1_000), 600_000);

		return new Promise<JsonValue>((resolvePromise, rejectPromise) => {
			const reject = (error: Error) => {
				this.pending.delete(id);
				this.terminate(error);
				rejectPromise(error);
			};
			const timer = setTimeout(() => reject(new Error(`Web Verb sidecar timed out after ${timeoutMs} ms`)), timeoutMs);
			const onAbort = () => reject(new Error("Web Verb sidecar request aborted"));
			if (options?.signal?.aborted) {
				clearTimeout(timer);
				rejectPromise(new Error("Web Verb sidecar request aborted"));
				return;
			}
			options?.signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.set(id, {
				resolve: resolvePromise,
				reject: rejectPromise,
				timer,
				cleanupAbort: options?.signal ? () => options.signal?.removeEventListener("abort", onAbort) : undefined,
			});
			child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	}

	async close(): Promise<void> {
		if (!this.child) return;
		try {
			await this.request("shutdown", {}, { timeoutMs: 5_000 });
		} catch {
			this.terminate(new Error("Web Verb sidecar closed"));
		}
	}

	private ensureProcess(): ChildProcessWithoutNullStreams {
		if (this.child) return this.child;
		const script = resolve(this.packageRoot, "sidecar", "server.py");
		const child = spawn(this.python, ["-u", script], { cwd: this.packageRoot, stdio: ["pipe", "pipe", "pipe"] });
		this.child = child;
		this.stderr = "";

		child.stdout.on("data", (chunk: Buffer) => this.consume(chunk.toString()));
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderr = `${this.stderr}${chunk.toString()}`.slice(-16_384);
		});
		child.on("error", (error) => this.terminate(error));
		child.on("close", (code) => {
			if (this.child !== child) return;
			this.terminate(new Error(`Web Verb sidecar exited with code ${code ?? "unknown"}: ${this.stderr.trim()}`));
		});
		return child;
	}

	private consume(chunk: string): void {
		this.buffer += chunk;
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			let response: RpcResponse;
			try {
				response = JSON.parse(line) as RpcResponse;
			} catch {
				this.terminate(new Error(`Invalid JSON from Web Verb sidecar: ${line.slice(0, 200)}`));
				return;
			}
			const pending = this.pending.get(response.id);
			if (!pending) continue;
			this.pending.delete(response.id);
			clearTimeout(pending.timer);
			pending.cleanupAbort?.();
			if (response.error) pending.reject(new Error(response.error.message ?? "Unknown sidecar error"));
			else pending.resolve(response.result ?? null);
		}
	}

	private terminate(error: Error): void {
		const child = this.child;
		this.child = undefined;
		if (child && !child.killed) child.kill("SIGTERM");
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.cleanupAbort?.();
			pending.reject(error);
		}
		this.pending.clear();
	}
}
