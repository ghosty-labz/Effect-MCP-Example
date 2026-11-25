# effect-mcp-example

An idiomatic [Effect v4](https://effect.website/) stdio Model Context Protocol (MCP) server example built with `effect@4.1.5` and `@effect/platform-node@4.1.5`.

The server implements an in-memory developer notes and code snippets workspace backed by an Effect `Context.Service` + `Ref` layer (`NotesStore`), demonstrating:

- **Typed MCP tools** (`Tool` + `Toolkit` + `McpServer.toolkit`) with `Schema` inputs, structured outputs, MCP tool annotations, and `Schema.TaggedError` domain errors
- **Static resources & parameterized resource templates** (`McpServer.resource` and tagged-template `McpServer.resource\`...\``) with argument completions
- **Parameterized prompts** (`McpServer.prompt`) returning structured `PromptMessage` responses with argument completions
- **Safe stdio transport** (`McpServer.layerStdio`) with newest-first protocol negotiation (`2025-11-25` down to `2024-11-05`), stderr-only Effect logging (`Logger.LogToStderr`), and `NodeRuntime.runMain({ disableErrorReporting: true })` so `stdout` stays strictly valid JSON-RPC
- **In-memory and end-to-end stdio tests** using `McpTest.makeClient` and a live Node subprocess harness

## Prerequisites

- **Node.js `>= 22.19.0`** (required by `@effect/platform-node@4.1.5`)
- **npm** (or any Node package manager)

## Quick Start

```bash
# Install dependencies
npm install

# Typecheck src/ and test/
npm run typecheck

# Compile TypeScript to dist/
npm run build

# Run in-memory and end-to-end stdio tests (builds dist/ automatically via pretest)
npm test

# Run the stdio MCP server (compiled)
npm start

# Or run directly from TypeScript source during development
npm run dev
```

## Project Structure

```text
.
├── src/
│   ├── domain.ts          # Effect Schema models and Schema.TaggedError domain errors
│   ├── store.ts           # NotesStore Context.Service backed by Ref + Clock
│   ├── mcp/
│   │   ├── tools.ts       # list_notes, get_note, create_note, update_note, delete_note
│   │   ├── resources.ts   # notes://guide, notes://index, notes://item/{id}, notes://tag/{tag}
│   │   ├── prompts.ts     # review_note and summarize_workspace prompts
│   │   └── server.ts      # Protocol list, registration bundle, and McpServer.layerStdio
│   └── index.ts           # Stdio CLI entrypoint with stderr-only logging
├── test/
│   ├── mcp.test.ts        # In-memory tests via McpTest.makeClient
│   └── stdio.e2e.test.ts  # End-to-end NDJSON-RPC stdio subprocess smoke test
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

## Exposed MCP Capabilities

### Tools

| Tool | Description | Annotations |
|---|---|---|
| `list_notes` | List notes with optional `category`, `tag`, and `query` filters | read-only, idempotent |
| `get_note` | Retrieve a note by slug `id` | read-only, idempotent |
| `create_note` | Create a note, snippet, decision, or todo | non-destructive |
| `update_note` | Update fields on an existing note | idempotent, non-destructive |
| `delete_note` | Delete a note by slug `id` | destructive |

### Resources & Resource Templates

- `notes://guide` (`text/markdown`) — Static overview of URI conventions and categories
- `notes://index` (`application/json`) — Live JSON summary of all notes, category counts, and tag counts
- `notes://item/{id}` (`application/json`) — Full JSON for a single note (supports `id` completion)
- `notes://tag/{tag}` (`application/json`) — All notes matching `{tag}` (supports `tag` completion)

### Prompts

- `review_note` (`id`, optional `focus`: `clarity` | `correctness` | `action-items`) — Builds a review prompt with the note's content and metadata
- `summarize_workspace` (optional `category`, optional `style`: `brief` | `detailed`) — Builds a summary prompt across matching workspace notes

## Using with Cursor (`.cursor/mcp.json`)

Build the project once (`npm run build`), then add this to `.cursor/mcp.json` (replacing `/absolute/path/to/Effect-MCP-Example` with your local clone path):

```json
{
  "mcpServers": {
    "effect-mcp-example": {
      "command": "node",
      "args": ["/absolute/path/to/Effect-MCP-Example/dist/index.js"]
    }
  }
}
```

## Key Effect v4 Stdio Notes

1. **Construction-time vs. request-level services**: Services needed by `McpServer.resource` and `McpServer.prompt` handlers are resolved at construction time inside `Layer.unwrap(Effect.gen(...))` (and inside `Toolkit.toLayer(Effect.gen(...))` for tools) so they do not leak into request-level `McpRequest<"Requires", S>` requirements.
2. **Keeping `stdout` strictly JSON-RPC**: `Logger.LogToStderr` routes built-in Effect logs to `stderr`, and `NodeRuntime.runMain(main, { disableErrorReporting: true })` prevents `NodeRuntime`'s outer error reporter from writing startup/fatal errors to `stdout`.
