import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const launcherPath = realpathSync(fileURLToPath(import.meta.url));
const packageRoot = dirname(dirname(launcherPath));
const agentDir = join(packageRoot, ".pi");
const piCli = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
const taskDirectory = process.env.INIT_CWD || process.cwd();
const webVerbsDirectory = join(agentDir, "web-verbs");

const webVerbsPythonCandidates = process.platform === "win32"
	? [join(webVerbsDirectory, "venv", "Scripts", "python.exe")]
	: [join(webVerbsDirectory, "venv", "bin", "python")];
const chromeCandidates = process.platform === "darwin"
	? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
	: process.platform === "win32"
		? [
			"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
			"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
		]
		: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

function firstExisting(candidates) {
	return candidates.find((candidate) => existsSync(candidate));
}

if (!existsSync(piCli)) {
	console.error(`Pi runtime not found at ${piCli}. Run \"npm install --ignore-scripts\" in ${packageRoot}.`);
	process.exit(1);
}

const webVerbsPython = process.env.PI_WEB_VERBS_PYTHON || firstExisting(webVerbsPythonCandidates);
const chromeExecutable = process.env.PI_WEB_VERBS_CHROME_EXECUTABLE || firstExisting(chromeCandidates);
const childEnvironment = {
	...process.env,
	PI_CODING_AGENT_DIR: agentDir,
	PI_WEB_VERBS_HEADLESS: process.env.PI_WEB_VERBS_HEADLESS || "1",
};
if (webVerbsPython) childEnvironment.PI_WEB_VERBS_PYTHON = webVerbsPython;
if (chromeExecutable) childEnvironment.PI_WEB_VERBS_CHROME_EXECUTABLE = chromeExecutable;

const child = spawn(process.execPath, [piCli, ...process.argv.slice(2), "--no-approve"], {
	cwd: taskDirectory,
	env: childEnvironment,
	stdio: "inherit",
});

child.once("error", (error) => {
	console.error(`Failed to start Pi Coding Agent: ${error.message}`);
	process.exit(1);
});

child.once("exit", (code) => {
	process.exit(code ?? 1);
});
