def execute(request: dict[str, object]) -> dict[str, object]:
    return {
        "__webVerb": {
            "output": request,
            "actualSideEffects": ["test-observation"],
            "evidenceUrls": ["https://example.test/evidence"],
            "notes": ["metadata wrapper decoded"],
        }
    }
