import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const launcherPath = realpathSync(fileURLToPath(import.meta.url));
const packageRoot = dirname(dirname(launcherPath));
const agentDir = join(packageRoot, ".pi");
const piCli = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
const taskDirectory = process.env.INIT_CWD || process.cwd();

if (!existsSync(piCli)) {
	console.error(`Pi runtime not found at ${piCli}. Run \"npm install --ignore-scripts\" in ${packageRoot}.`);
	process.exit(1);
}

const child = spawn(process.execPath, [piCli, ...process.argv.slice(2), "--no-approve"], {
	cwd: taskDirectory,
	env: {
		...process.env,
		PI_CODING_AGENT_DIR: agentDir,
	},
	stdio: "inherit",
});

child.once("error", (error) => {
	console.error(`Failed to start Pi Coding Agent: ${error.message}`);
	process.exit(1);
});

child.once("exit", (code) => {
	process.exit(code ?? 1);
});
