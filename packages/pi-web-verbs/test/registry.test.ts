import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { VerbRegistry } from "../src/registry.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("VerbRegistry", () => {
	it("loads and searches the packaged diagnostic verb", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-web-verbs-registry-"));
		temporaryDirectories.push(cwd);
		const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
		const registry = new VerbRegistry(cwd, packageRoot);

		await registry.reload();

		expect(registry.get("local.echo").version).toBe("1.0.0");
		expect(registry.get("search.web").implementations[0]?.id).toBe("playwright-browser");
		expect(registry.get("search.web").postconditions[0]?.value).toContain("bing\\.com");
		expect(registry.search({ task: "public web search" }).map((verb) => verb.name)).toEqual(["search.web"]);
		expect(registry.search({ task: "diagnostic echo" }).map((verb) => verb.name)).toEqual(["local.echo"]);
		expect(() => registry.validateInput(registry.get("local.echo"), { message: 42 })).toThrow("Schema validation failed");
	});
});
