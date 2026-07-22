from __future__ import annotations

import asyncio
import dataclasses
import datetime
import enum
import importlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import sys
import traceback
import uuid
from typing import Any


def to_json_value(value: Any) -> Any:
    if dataclasses.is_dataclass(value):
        return {field.name: to_json_value(getattr(value, field.name)) for field in dataclasses.fields(value)}
    if isinstance(value, enum.Enum):
        return to_json_value(value.value)
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): to_json_value(child) for key, child in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_json_value(child) for child in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"Value of type {type(value).__name__} is not JSON serializable")


class BrowserPool:
    def __init__(self) -> None:
        self._playwright: Any = None
        self._contexts: dict[str, Any] = {}

    async def page(self, cwd: str, profile: str | None) -> tuple[Any, str]:
        profile_name = profile or "default"
        context = self._contexts.get(profile_name)
        if context is None:
            try:
                from playwright.async_api import async_playwright
            except ImportError as error:
                raise RuntimeError("Browser verbs require the Python 'playwright' package") from error
            if self._playwright is None:
                self._playwright = await async_playwright().start()
            profile_dir = Path(cwd, ".pi", "web-verbs", "profiles", profile_name)
            profile_dir.mkdir(parents=True, exist_ok=True)
            headless = os.environ.get("PI_WEB_VERBS_HEADLESS", "0") == "1"
            context = await self._playwright.chromium.launch_persistent_context(str(profile_dir), headless=headless)
            self._contexts[profile_name] = context
        page = context.pages[0] if context.pages else await context.new_page()
        return page, profile_name

    async def close(self) -> None:
        for context in self._contexts.values():
            await context.close()
        self._contexts.clear()
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None


def load_module(implementation: dict[str, Any]) -> Any:
    module_name = implementation.get("module")
    source = implementation.get("source")
    if isinstance(module_name, str):
        return importlib.import_module(module_name)
    if not isinstance(source, str):
        raise ValueError("Implementation requires either module or source")
    source_path = Path(source).resolve()
    name = f"pi_web_verb_{source_path.stem}_{abs(hash(source_path))}"
    spec = importlib.util.spec_from_file_location(name, source_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load Web Verb source {source_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def build_request(module: Any, implementation: dict[str, Any], values: dict[str, Any]) -> Any:
    request_class = implementation.get("requestClass")
    if not isinstance(request_class, str):
        return values
    cls = getattr(module, request_class)
    return cls(**values)


async def evaluate_conditions(conditions: list[dict[str, Any]], page: Any) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for condition in conditions:
        kind = condition.get("kind")
        value = condition.get("value")
        passed = False
        detail: str | None = None
        try:
            if kind == "url-matches" and page is not None and isinstance(value, str):
                passed = re.search(value, page.url) is not None
                detail = page.url
            elif kind == "selector-exists" and page is not None and isinstance(value, str):
                passed = await page.locator(value).count() > 0
                detail = value
            else:
                detail = f"Unsupported or unavailable condition kind: {kind}"
        except Exception as error:
            detail = str(error)
        results.append({"id": str(condition.get("id", "condition")), "passed": passed, "detail": detail})
    return results


async def execute_call(params: dict[str, Any], browsers: BrowserPool) -> dict[str, Any]:
    verb = params["verb"]
    implementation = params["implementation"]
    input_value = params["input"]
    context = params["context"]
    module = load_module(implementation)
    function = getattr(module, implementation["function"])
    request = build_request(module, implementation, input_value)
    page = None
    profile = context.get("profile")
    session_id = None
    reported_urls: list[str] = []

    if implementation["backend"] == "browser":
        page, profile = await browsers.page(context["cwd"], profile)
        session_id = str(id(page.context))

    preconditions = await evaluate_conditions(verb.get("preconditions", []), page)
    if any(not item["passed"] for item in preconditions):
        raise RuntimeError("One or more Web Verb preconditions failed")

    arguments = (page, request) if page is not None else (request,)
    result = function(*arguments)
    if inspect.isawaitable(result):
        result = await result

    actual_side_effects: list[str] = []
    notes: list[str] = []
    metadata = result.get("__webVerb") if isinstance(result, dict) else None
    if isinstance(metadata, dict) and "output" in metadata:
        actual_side_effects = [str(item) for item in metadata.get("actualSideEffects", [])]
        notes = [str(item) for item in metadata.get("notes", [])]
        reported_urls = [str(item) for item in metadata.get("evidenceUrls", [])]
        result = metadata["output"]

    postconditions = await evaluate_conditions(verb.get("postconditions", []), page)
    if any(not item["passed"] for item in postconditions):
        raise RuntimeError("One or more Web Verb postconditions failed")

    urls: list[str] = reported_urls
    screenshots: list[str] = []
    dom_snapshots: list[str] = []
    if page is not None:
        urls.append(page.url)
        evidence_dir = Path(context["evidenceDir"])
        evidence_dir.mkdir(parents=True, exist_ok=True)
        screenshot = evidence_dir / f"{verb['name'].replace('.', '_')}-{uuid.uuid4().hex}.png"
        await page.screenshot(path=str(screenshot), full_page=True)
        screenshots.append(str(screenshot))
        if os.environ.get("PI_WEB_VERBS_CAPTURE_DOM") == "1":
            dom_path = screenshot.with_suffix(".html")
            dom_path.write_text(await page.content(), encoding="utf-8")
            dom_snapshots.append(str(dom_path))

    return {
        "output": to_json_value(result),
        "preconditions": preconditions,
        "postconditions": postconditions,
        "evidence": {"urls": urls, "screenshots": screenshots, "domSnapshots": dom_snapshots, "notes": notes},
        "actualSideEffects": actual_side_effects,
        "session": {"id": session_id, "profile": profile},
    }


async def main() -> None:
    browsers = BrowserPool()
    try:
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            request: dict[str, Any] = json.loads(line)
            request_id = str(request.get("id", ""))
            should_stop = request.get("method") == "shutdown"
            try:
                if should_stop:
                    await browsers.close()
                    result: Any = {"closed": True}
                elif request.get("method") == "call":
                    result = await execute_call(request["params"], browsers)
                else:
                    raise ValueError(f"Unknown sidecar method: {request.get('method')}")
                response = {"id": request_id, "result": result}
            except Exception as error:
                traceback.print_exc(file=sys.stderr)
                response = {"id": request_id, "error": {"type": type(error).__name__, "message": str(error)}}
            sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
            sys.stdout.flush()
            if should_stop:
                break
    finally:
        await browsers.close()


if __name__ == "__main__":
    asyncio.run(main())
