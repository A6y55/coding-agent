from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT / "sidecar"))

from pi_web_verbs_sidecar.verbs.searxng_search import SearchRequest, execute  # noqa: E402


class FakeResponse:
    def __init__(self, value: object) -> None:
        self.payload = json.dumps(value).encode("utf-8")

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, _limit: int) -> bytes:
        return self.payload


class SearXNGSearchTest(unittest.TestCase):
    def test_returns_typed_ranked_results_and_evidence(self) -> None:
        response = {
            "query": "typed web agents",
            "results": [
                {
                    "title": "Web Verbs",
                    "url": "https://example.test/web-verbs",
                    "content": "Typed browser actions",
                    "engines": ["example"],
                    "score": 3.5,
                },
                {
                    "title": "Second result",
                    "url": "https://example.test/second",
                    "content": "Ignored because max_results is one",
                },
            ],
            "answers": ["A typed action"],
            "corrections": [],
            "suggestions": ["agentic web"],
            "unresponsive_engines": [["offline-engine", "timeout"]],
        }
        captured_url = ""

        def fake_urlopen(request: object, timeout: float) -> FakeResponse:
            nonlocal captured_url
            captured_url = request.full_url  # type: ignore[attr-defined]
            self.assertEqual(timeout, 20)
            return FakeResponse(response)

        with patch.dict(os.environ, {"PI_WEB_VERBS_SEARXNG_URL": "http://search.test:8080/"}, clear=False):
            with patch("pi_web_verbs_sidecar.verbs.searxng_search.urlopen", fake_urlopen):
                wrapped = execute(SearchRequest(query="typed web agents", max_results=1, categories=["general"]))

        metadata = wrapped["__webVerb"]
        result = metadata["output"]
        self.assertEqual(result.query, "typed web agents")
        self.assertEqual(len(result.results), 1)
        self.assertEqual(result.results[0].title, "Web Verbs")
        self.assertEqual(result.unresponsive_engines[0].engine, "offline-engine")
        self.assertEqual(metadata["evidenceUrls"], [captured_url])
        query = parse_qs(urlsplit(captured_url).query)
        self.assertEqual(query["format"], ["json"])
        self.assertEqual(query["categories"], ["general"])

    def test_rejects_non_http_endpoint(self) -> None:
        with patch.dict(os.environ, {"PI_WEB_VERBS_SEARXNG_URL": "file:///tmp/search"}, clear=False):
            with self.assertRaisesRegex(ValueError, "absolute http"):
                execute(SearchRequest(query="test"))


if __name__ == "__main__":
    unittest.main()
