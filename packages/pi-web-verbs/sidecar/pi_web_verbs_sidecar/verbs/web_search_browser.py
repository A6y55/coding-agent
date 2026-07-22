from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, quote_plus, urljoin, urlsplit


@dataclass(frozen=True)
class SearchRequest:
    query: str
    max_results: int = 10
    engine: str = "auto"


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    content: str
    engines: list[str]
    score: float
    published_date: str | None = None
    thumbnail: str | None = None


@dataclass(frozen=True)
class UnresponsiveEngine:
    engine: str
    error: str


@dataclass(frozen=True)
class SearchResponse:
    query: str
    results: list[SearchResult]
    answers: list[str]
    corrections: list[str]
    suggestions: list[str]
    unresponsive_engines: list[UnresponsiveEngine]


ENGINE_CONFIG = {
    "duckduckgo": {
        "url": "https://html.duckduckgo.com/html/?q={query}",
        "result": ".result",
        "link": ".result__a",
        "snippet": ".result__snippet",
    },
    "bing": {
        "url": "https://www.bing.com/search?q={query}",
        "result": "li.b_algo",
        "link": "h2 a",
        "snippet": ".b_caption p",
    },
}


def _normalize_url(href: str, page_url: str, engine: str) -> str | None:
    absolute = urljoin(page_url, href)
    parsed = urlsplit(absolute)
    if engine == "duckduckgo" and parsed.hostname and parsed.hostname.endswith("duckduckgo.com"):
        redirected = parse_qs(parsed.query).get("uddg")
        if redirected:
            absolute = redirected[0]
            parsed = urlsplit(absolute)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    return absolute


async def _text(locator: Any) -> str:
    try:
        if await locator.count() == 0:
            return ""
        return (await locator.first.inner_text(timeout=3_000)).strip()
    except Exception:
        return ""


async def _search_engine(page: Any, request: SearchRequest, engine: str) -> list[SearchResult]:
    config = ENGINE_CONFIG[engine]
    search_url = str(config["url"]).format(query=quote_plus(request.query))
    await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)
    await page.wait_for_timeout(1_000)

    blocks = page.locator(str(config["result"]))
    block_count = await blocks.count()
    results: list[SearchResult] = []
    seen_urls: set[str] = set()
    for index in range(block_count):
        block = blocks.nth(index)
        link = block.locator(str(config["link"])).first
        try:
            title = (await link.inner_text(timeout=3_000)).strip()
            href = await link.get_attribute("href", timeout=3_000)
        except Exception:
            continue
        if not title or not href:
            continue
        url = _normalize_url(href, page.url, engine)
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        content = await _text(block.locator(str(config["snippet"])))
        results.append(
            SearchResult(
                title=title,
                url=url,
                content=content,
                engines=[engine],
                score=1.0 / (len(results) + 1),
            )
        )
        if len(results) >= request.max_results:
            break

    if not results:
        raise RuntimeError(f"{engine} returned no structured search results")
    return results


async def execute(page: Any, request: SearchRequest) -> dict[str, Any]:
    if request.engine not in {"auto", *ENGINE_CONFIG.keys()}:
        raise ValueError(f"Unsupported search engine: {request.engine}")
    engines = list(ENGINE_CONFIG) if request.engine == "auto" else [request.engine]
    failures: list[UnresponsiveEngine] = []

    for engine in engines:
        try:
            results = await _search_engine(page, request, engine)
            response = SearchResponse(
                query=request.query,
                results=results,
                answers=[],
                corrections=[],
                suggestions=[],
                unresponsive_engines=failures,
            )
            return {
                "__webVerb": {
                    "output": response,
                    "actualSideEffects": [],
                    "notes": [f"Search results were extracted from {engine} in a Playwright browser."],
                }
            }
        except Exception as error:
            failures.append(UnresponsiveEngine(engine=engine, error=str(error)))

    details = "; ".join(f"{failure.engine}: {failure.error}" for failure in failures)
    raise RuntimeError(f"All browser search engines failed: {details}")
