# pi-web-verbs

`pi-web-verbs` is an optional Pi extension package. It exposes typed web actions
without making browser control part of the Coding Agent core.

## Tool surface

- `web_verb_search`: search metadata without loading every Verb into context.
- `web_verb_describe`: load one full contract.
- `web_verb_call`: validate input, approve risk, execute, validate output, and audit.
- `web_verb_program`: compose calls with references, conditions, loops, retries,
  checkpoints, and resume.

## Registry

The extension loads manifests from the package `verbs/` directory and from
`<cwd>/.pi/web-verbs/verbs`. A manifest declares its input/output JSON Schemas,
sites, contract checks, auth requirements, risk, side effects, implementations,
version, and test status. Site implementations are never inserted into the model
context.

`PI_WEB_VERBS_PATH` may add registry directories using the platform path
separator. `PI_WEB_VERBS_PYTHON` selects the Python executable.

## Sidecar adapters

The bundled Python sidecar supports:

- `python`: a typed or ordinary Python function.
- `browser`: a Playwright function with `(page, request)` shape, including the
  dataclass convention used by MSR-Web-Verbs.

Browser implementations require Playwright in the selected Python environment:

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
```

The built-in `search.web` Verb uses a SearXNG instance without an API key. Set
`PI_WEB_VERBS_SEARXNG_URL` to its base URL; the default is
`http://127.0.0.1:8080`. The instance must enable JSON in `search.formats`.

An MSR-generated Verb is connected by a local manifest whose `source` points to
the reviewed Python file and whose `requestClass` and `function` identify its
public typed API. This repository does not download or activate generated site
code automatically.

## Security

`write-remote`, `message`, `purchase`, `delete`, and `auth` calls require an
interactive confirmation. They are blocked in non-interactive mode. Audit JSONL
records are written under `.pi/web-verbs/audit`; obvious secret fields are
redacted. Python and Playwright implementations still execute code, so manifests
and source files must be reviewed like any other Pi extension.

Generated, repaired, and published Verbs are intentionally outside this first
runtime package. Production activation should require a separate pipeline that
records contract-test success and human approval before changing a manifest's
status to `active`.
