import { Effect, Layer, Schema } from "effect"
import { McpServer, Tool, Toolkit } from "effect/ai"
import {
  InvalidNoteInputError,
  Note,
  NoteAlreadyExistsError,
  NoteCategory,
  NoteNotFoundError,
  NoteSummary,
  toNoteSummary
} from "../domain.js"
import { NotesStore } from "../store.js"

export const ListNotesTool = Tool.make("list_notes", {
  description: "List workspace notes and code snippets with optional category, tag, or text filters.",
  parameters: Schema.Struct({
    category: Schema.optionalKey(NoteCategory),
    tag: Schema.optionalKey(
      Schema.String.annotate({ description: "Filter to notes containing this tag (case-insensitive)" })
    ),
    query: Schema.optionalKey(
      Schema.String.annotate({ description: "Substring search across id, title, content, and tags" })
    )
  }),
  success: Schema.Struct({
    count: Schema.Number,
    notes: Schema.Array(NoteSummary)
  })
})
  .annotate(Tool.Title, "List Notes")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const GetNoteTool = Tool.make("get_note", {
  description: "Retrieve a single workspace note or code snippet by its unique slug ID.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Unique slug ID of the note to retrieve" })
  }),
  success: Note,
  failure: NoteNotFoundError
})
  .annotate(Tool.Title, "Get Note")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const CreateNoteTool = Tool.make("create_note", {
  description: "Create a new note, code snippet, decision record, or todo item in the workspace.",
  parameters: Schema.Struct({
    id: Schema.optionalKey(
      Schema.String.annotate({
        description: "Optional lowercase slug ID; derived from title if omitted"
      })
    ),
    title: Schema.String.annotate({ description: "Short human-readable title" }),
    content: Schema.String.annotate({ description: "Markdown or source-code body" }),
    category: Schema.optionalKey(NoteCategory),
    tags: Schema.optionalKey(
      Schema.Array(Schema.String).annotate({ description: "Optional tags for categorization" })
    ),
    language: Schema.optionalKey(
      Schema.String.annotate({ description: "Optional language identifier for code snippets" })
    )
  }),
  success: Note,
  failure: Schema.Union([NoteAlreadyExistsError, InvalidNoteInputError])
})
  .annotate(Tool.Title, "Create Note")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)

export const UpdateNoteTool = Tool.make("update_note", {
  description: "Update one or more fields on an existing workspace note.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Unique slug ID of the note to update" }),
    title: Schema.optionalKey(Schema.String.annotate({ description: "Updated title" })),
    content: Schema.optionalKey(Schema.String.annotate({ description: "Updated body content" })),
    category: Schema.optionalKey(NoteCategory),
    tags: Schema.optionalKey(
      Schema.Array(Schema.String).annotate({ description: "Replacement list of tags" })
    ),
    language: Schema.optionalKey(
      Schema.String.annotate({
        description: "Updated language identifier; pass an empty string to clear"
      })
    )
  }),
  success: Note,
  failure: Schema.Union([NoteNotFoundError, InvalidNoteInputError])
})
  .annotate(Tool.Title, "Update Note")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const DeleteNoteTool = Tool.make("delete_note", {
  description: "Permanently delete a note from the in-memory workspace by its slug ID.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Unique slug ID of the note to delete" })
  }),
  success: Schema.Struct({
    deleted: Schema.Literal(true),
    id: Schema.String
  }),
  failure: NoteNotFoundError
})
  .annotate(Tool.Title, "Delete Note")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)

export const NotesToolkit = Toolkit.make(
  ListNotesTool,
  GetNoteTool,
  CreateNoteTool,
  UpdateNoteTool,
  DeleteNoteTool
)

const NotesToolkitHandlers = NotesToolkit.toLayer(
  Effect.gen(function*() {
    const store = yield* NotesStore

    return NotesToolkit.of({
      list_notes: Effect.fn("tool.list_notes")(function*(params) {
        const notes = yield* store.list(params)
        return {
          count: notes.length,
          notes: notes.map(toNoteSummary)
        }
      }),
      get_note: Effect.fn("tool.get_note")(function*({ id }) {
        return yield* store.get(id)
      }),
      create_note: Effect.fn("tool.create_note")(function*(params) {
        return yield* store.create(params)
      }),
      update_note: Effect.fn("tool.update_note")(function*(params) {
        return yield* store.update(params)
      }),
      delete_note: Effect.fn("tool.delete_note")(function*({ id }) {
        yield* store.remove(id)
        return { deleted: true as const, id }
      })
    })
  })
)

export const ToolsLayer = McpServer.toolkit(NotesToolkit).pipe(
  Layer.provide(NotesToolkitHandlers)
)
