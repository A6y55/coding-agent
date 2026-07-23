import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import runtimeReloadExtension from "../extensions/runtime-reload/index.ts";

describe("runtime reload extension", () => {
	it("exposes user commands without tools that can requeue those commands", () => {
		const registerCommand = vi.fn();
		const registerTool = vi.fn();
		const sendUserMessage = vi.fn();
		const pi = { registerCommand, registerTool, sendUserMessage } as unknown as ExtensionAPI;

		runtimeReloadExtension(pi);

		expect(registerCommand.mock.calls.map(([name]) => name)).toEqual(["reload-runtime", "rollback-runtime"]);
		expect(registerTool).not.toHaveBeenCalled();
		expect(sendUserMessage).not.toHaveBeenCalled();
	});
});
