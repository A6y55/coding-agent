---
name: find-docs
description: Fetch current library, framework, SDK, API, and CLI documentation with the Context7 CLI. Use for API syntax, configuration, setup, migration, and library-specific debugging.
---

# Find Docs

Use Context7 through its CLI. Do not configure or call a Context7 MCP server.

## Workflow

1. Resolve the library ID unless the user already supplied an ID in `/owner/project` format:

   ```bash
   npm_config_cache="/tmp/pi-coding-agent-ctx7-$UID" npx -y ctx7@latest library <name> "<single-topic question>"
   ```

2. Select the closest official project using name match, description, source reputation, snippet count, and benchmark score.

3. Fetch the relevant documentation:

   ```bash
   npm_config_cache="/tmp/pi-coding-agent-ctx7-$UID" npx -y ctx7@latest docs <libraryId> "<single-topic question>"
   ```

Use a separate `docs` request for each distinct concept. Do not make more than three Context7 CLI requests for one user question. Add `--json` when structured output is useful.

## Rules

- Use the user's detailed question instead of a vague keyword.
- Never put credentials, personal data, or proprietary source text in a query.
- Prefer version-specific library IDs when the user specifies a version.
- If authentication or quota blocks the request, ask the user to run `npm_config_cache="/tmp/pi-coding-agent-ctx7-$UID" npx -y ctx7@latest login` or provide `CONTEXT7_API_KEY` in the process environment.
- If Context7 has no relevant documentation, say so explicitly. Do not present recalled API details as current documentation.
