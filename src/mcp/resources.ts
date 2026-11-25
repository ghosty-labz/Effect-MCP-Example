import { Effect, Layer, Schema } from "effect"
import { McpSchema, McpServer } from "effect/ai"
import { toNoteSummary } from "../domain.js"
import { NotesStore } from "../store.js"

const NoteIdParam = McpSchema.param("id", Schema.String)
const TagParam = McpSchema.param("tag", Schema.String)

const WORKSPACE_GUIDE = [
  "# Developer Notes Workspace Guide",
  "",
  "This MCP server manages an in-memory workspace of developer notes, code snippets,",
  "architecture decisions, and follow-up todos.",
  "",
  "## Resource URIs",
  "- `notes://index` — Live JSON summary of all notes, categories, and tags",
  "- `notes://guide` — This reference guide",
  "- `notes://item/{id}` — Full JSON payload for a single note by slug ID",
  "- `notes://tag/{tag}` — JSON list of all notes tagged with `{tag}`",
  "",
  "## Categories",
  "- `note`: general technical notes",
  "- `snippet`: reusable code snippets (supports optional `language`)",
  "- `decision`: architecture or engineering decisions",
  "- `todo`: follow-up tasks"
].join("\n")

const GuideResource = McpServer.resource({
  uri: "notes://guide",
  name: "Workspace Guide",
  description: "Overview of workspace resource URIs and note categories",
  mimeType: "text/markdown",
  content: Effect.succeed(WORKSPACE_GUIDE)
})

const DynamicResourcesLayer = Layer.unwrap(
  Effect.gen(function*() {
    const store = yield* NotesStore

    const indexResource = McpServer.resource({
      uri: "notes://index",
      name: "Workspace Index",
      description: "Live JSON index of all notes and aggregate workspace statistics",
      mimeType: "application/json",
      content: Effect.fn("resource.notes_index")(function*() {
        const [notes, stats] = yield* Effect.all([store.list(), store.stats()])
        return JSON.stringify(
          {
            stats,
            notes: notes.map(toNoteSummary)
          },
          null,
          2
        )
      })()
    })

    const noteByIdTemplate = McpServer.resource`notes://item/${NoteIdParam}`({
      name: "Note by ID",
      description: "Read the full JSON representation of a note by its slug ID",
      mimeType: "application/json",
      completion: {
        id: (input) =>
          Effect.map(store.listIds(), (ids) => {
            const prefix = input.trim().toLowerCase()
            return ids.filter((id) => id.startsWith(prefix))
          })
      },
      content: Effect.fn("resource.note_by_id")(function*(_uri, id) {
        const note = yield* store.get(id)
        return JSON.stringify(note, null, 2)
      })
    })

    const notesByTagTemplate = McpServer.resource`notes://tag/${TagParam}`({
      name: "Notes by Tag",
      description: "Read all notes matching a specific tag",
      mimeType: "application/json",
      completion: {
        tag: (input) =>
          Effect.map(store.listTags(), (tags) => {
            const prefix = input.trim().toLowerCase()
            return tags.map((entry) => entry.tag).filter((tag) => tag.startsWith(prefix))
          })
      },
      content: Effect.fn("resource.notes_by_tag")(function*(_uri, tag) {
        const normalized = tag.trim().toLowerCase()
        const notes = yield* store.list({ tag: normalized })
        return JSON.stringify(
          {
            tag: normalized,
            count: notes.length,
            notes
          },
          null,
          2
        )
      })
    })

    return Layer.mergeAll(indexResource, noteByIdTemplate, notesByTagTemplate)
  })
)

export const ResourcesLayer = Layer.mergeAll(GuideResource, DynamicResourcesLayer)
