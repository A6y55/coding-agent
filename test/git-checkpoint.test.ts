import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createGitCheckpoint, restoreGitCheckpoint } from "../src/git-checkpoint.ts";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Git checkpoint", () => {
	it("captures untracked content without touching the real index and restores it after approval logic", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-git-checkpoint-"));
		temporaryDirectories.push(cwd);
		await execFileAsync("git", ["init", "--quiet"], { cwd });
		await writeFile(join(cwd, "state.txt"), "before\n", "utf8");
		const statusBefore = (await execFileAsync("git", ["status", "--porcelain=v1"], { cwd })).stdout;

		const checkpoint = await createGitCheckpoint(cwd, "test");

		expect(checkpoint).toBeDefined();
		const statusAfter = (await execFileAsync("git", ["status", "--porcelain=v1"], { cwd })).stdout;
		expect(statusAfter).toBe(statusBefore);
		await writeFile(join(cwd, "state.txt"), "after\n", "utf8");
		await restoreGitCheckpoint(cwd, checkpoint!);
		expect(await readFile(join(cwd, "state.txt"), "utf8")).toBe("before\n");
	});
});
