from __future__ import annotations

from dataclasses import dataclass
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen


MAX_RESPONSE_BYTES = 5_000_000


@dataclass(frozen=True)
class SearchRequest:
    query: str
    max_results: int = 10
    page: int = 1
    language: str = "all"
    categories: list[str] | None = None
    engines: list[str] | None = None
    safe_search: int = 1
    time_range: str | None = None


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


def _search_endpoint() -> str:
    base_url = os.environ.get("PI_WEB_VERBS_SEARXNG_URL", "http://127.0.0.1:8080").strip()
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("PI_WEB_VERBS_SEARXNG_URL must be an absolute http(s) URL")
    path = f"{parsed.path.rstrip('/')}/search"
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def _as_strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    values: list[str] = []
    for item in value:
        if isinstance(item, str):
            values.append(item)
        elif isinstance(item, dict):
            text = item.get("answer") or item.get("content") or item.get("title")
            if isinstance(text, str):
                values.append(text)
            else:
                values.append(json.dumps(item, ensure_ascii=False, sort_keys=True))
        elif item is not None:
            values.append(str(item))
    return values


def _as_engines(value: Any, fallback: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        return [value]
    if isinstance(fallback, str):
        return [fallback]
    return []


def _as_unresponsive_engines(value: Any) -> list[UnresponsiveEngine]:
    if not isinstance(value, list):
        return []
    engines: list[UnresponsiveEngine] = []
    for item in value:
        if isinstance(item, (list, tuple)) and item:
            engines.append(UnresponsiveEngine(engine=str(item[0]), error=str(item[1] if len(item) > 1 else "unknown")))
        elif isinstance(item, dict):
            engine = item.get("engine") or item.get("name") or "unknown"
            error = item.get("error") or item.get("message") or "unknown"
            engines.append(UnresponsiveEngine(engine=str(engine), error=str(error)))
        elif item is not None:
            engines.append(UnresponsiveEngine(engine=str(item), error="unknown"))
    return engines


def _normalize_results(value: Any, limit: int) -> list[SearchResult]:
    if not isinstance(value, list):
        return []
    results: list[SearchResult] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = item.get("title")
        url = item.get("url")
        if not isinstance(title, str) or not isinstance(url, str):
            continue
        raw_score = item.get("score", 0)
        score = float(raw_score) if isinstance(raw_score, (int, float)) else 0.0
        published_date = item.get("publishedDate") or item.get("published_date")
        thumbnail = item.get("thumbnail") or item.get("img_src")
        results.append(
            SearchResult(
                title=title,
                url=url,
                content=str(item.get("content") or ""),
                engines=_as_engines(item.get("engines"), item.get("engine")),
                score=score,
                published_date=str(published_date) if published_date else None,
                thumbnail=str(thumbnail) if thumbnail else None,
            )
        )
        if len(results) >= limit:
            break
    return results


def execute(request: SearchRequest) -> dict[str, Any]:
    endpoint = _search_endpoint()
    params: dict[str, Any] = {
        "q": request.query,
        "format": "json",
        "pageno": request.page,
        "language": request.language,
        "safesearch": request.safe_search,
    }
    if request.categories:
        params["categories"] = ",".join(request.categories)
    if request.engines:
        params["engines"] = ",".join(request.engines)
    if request.time_range:
        params["time_range"] = request.time_range

    search_url = f"{endpoint}?{urlencode(params)}"
    http_request = Request(
        search_url,
        headers={"Accept": "application/json", "User-Agent": "pi-web-verbs/0.1"},
    )
    timeout = float(os.environ.get("PI_WEB_VERBS_SEARCH_TIMEOUT", "20"))
    try:
        with urlopen(http_request, timeout=timeout) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except (HTTPError, URLError, TimeoutError) as error:
        raise RuntimeError(f"SearXNG request failed at {endpoint}: {error}") from error
    if len(payload) > MAX_RESPONSE_BYTES:
        raise RuntimeError("SearXNG response exceeded 5 MB")

    decoded = json.loads(payload)
    if not isinstance(decoded, dict):
        raise RuntimeError("SearXNG returned a non-object JSON response")

    response = SearchResponse(
        query=str(decoded.get("query") or request.query),
        results=_normalize_results(decoded.get("results"), request.max_results),
        answers=_as_strings(decoded.get("answers")),
        corrections=_as_strings(decoded.get("corrections")),
        suggestions=_as_strings(decoded.get("suggestions")),
        unresponsive_engines=_as_unresponsive_engines(decoded.get("unresponsive_engines")),
    )
    return {
        "__webVerb": {
            "output": response,
            "actualSideEffects": [],
            "evidenceUrls": [search_url],
            "notes": ["Results were returned by the configured SearXNG instance."],
        }
    }
