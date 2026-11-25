import { NodeStdio } from "@effect/platform-node"
import { Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { NotesStoreLive } from "../store.js"
import { PromptsLayer } from "./prompts.js"
import { ResourcesLayer } from "./resources.js"
import { ToolsLayer } from "./tools.js"

/**
 * Supported MCP protocol versions listed newest-first so stateful clients
 * negotiate the latest mutually supported specification.
 */
export const Protocols = [
  McpProtocol.v2025_11_25,
  McpProtocol.v2025_06_18,
  McpProtocol.v2025_03_26,
  McpProtocol.v2024_11_05
] as const

export const ServerInfo = {
  name: "effect-mcp-example",
  version: "1.0.0",
  instructions:
    "In-memory developer notes and code snippets workspace. Use list_notes, get_note, create_note, update_note, and delete_note to manage entries, read notes://index or notes://item/{id} resources, or invoke review_note and summarize_workspace prompts."
} as const

export const RegistrationsLayer = Layer.mergeAll(ToolsLayer, ResourcesLayer, PromptsLayer)

export const StdioServerLayer = McpServer.layerStdio({
  name: ServerInfo.name,
  version: ServerInfo.version,
  instructions: ServerInfo.instructions,
  protocols: Protocols,
  registrations: RegistrationsLayer
}).pipe(Layer.provide(NotesStoreLive()), Layer.provide(NodeStdio.layer))
