from __future__ import annotations

from pathlib import Path
import sys
import unittest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT / "sidecar"))

from pi_web_verbs_sidecar.verbs.web_search_browser import (  # noqa: E402
    SearchRequest,
    _normalize_url,
    execute,
)


class FakeField:
    def __init__(self, text: str = "", href: str | None = None) -> None:
        self.text = text
        self.href = href

    @property
    def first(self) -> "FakeField":
        return self

    async def count(self) -> int:
        return 1

    async def inner_text(self, timeout: int) -> str:
        return self.text

    async def get_attribute(self, name: str, timeout: int) -> str | None:
        return self.href if name == "href" else None


class FakeBlock:
    def __init__(self, title: str, href: str, snippet: str) -> None:
        self.link = FakeField(title, href)
        self.snippet = FakeField(snippet)

    def locator(self, selector: str) -> FakeField:
        return self.link if selector in {".result__a", "h2 a"} else self.snippet


class FakeBlocks:
    def __init__(self, blocks: list[FakeBlock]) -> None:
        self.blocks = blocks

    async def count(self) -> int:
        return len(self.blocks)

    def nth(self, index: int) -> FakeBlock:
        return self.blocks[index]


class FakePage:
    def __init__(self) -> None:
        self.url = ""
        self.visited: list[str] = []
        self.duckduckgo = FakeBlocks([])
        self.bing = FakeBlocks(
            [FakeBlock("Web Verbs", "https://example.test/web-verbs", "Typed browser actions")]
        )

    async def goto(self, url: str, **_kwargs: object) -> None:
        self.url = url
        self.visited.append(url)

    async def wait_for_timeout(self, _timeout: int) -> None:
        return None

    def locator(self, selector: str) -> FakeBlocks:
        return self.duckduckgo if selector == ".result" else self.bing


class BrowserSearchTest(unittest.IsolatedAsyncioTestCase):
    async def test_auto_falls_back_and_returns_typed_results(self) -> None:
        page = FakePage()
        wrapped = await execute(page, SearchRequest(query="typed web agents", max_results=1))

        result = wrapped["__webVerb"]["output"]
        self.assertEqual(result.query, "typed web agents")
        self.assertEqual(result.results[0].title, "Web Verbs")
        self.assertEqual(result.results[0].engines, ["bing"])
        self.assertEqual(result.unresponsive_engines[0].engine, "duckduckgo")
        self.assertEqual(len(page.visited), 2)

    def test_unwraps_duckduckgo_redirect(self) -> None:
        redirected = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2Farticle"
        self.assertEqual(
            _normalize_url(redirected, "https://html.duckduckgo.com/html/", "duckduckgo"),
            "https://example.test/article",
        )


if __name__ == "__main__":
    unittest.main()
