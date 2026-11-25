import { Schema } from "effect"

export const NoteCategory = Schema.Literals(["note", "snippet", "decision", "todo"]).annotate({
  description: "Category classifying the note"
})
export type NoteCategory = typeof NoteCategory.Type

export const Note = Schema.Struct({
  id: Schema.String.annotate({ description: "Unique slug identifier for the note" }),
  title: Schema.String.annotate({ description: "Short human-readable title" }),
  content: Schema.String.annotate({ description: "Markdown or code body of the note" }),
  category: NoteCategory,
  tags: Schema.Array(Schema.String).annotate({ description: "Lowercase search tags" }),
  language: Schema.optionalKey(
    Schema.String.annotate({ description: "Optional programming language for code snippets" })
  ),
  createdAt: Schema.String.annotate({ description: "ISO-8601 creation timestamp" }),
  updatedAt: Schema.String.annotate({ description: "ISO-8601 last-modified timestamp" })
})
export type Note = typeof Note.Type

export const NoteSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  category: NoteCategory,
  tags: Schema.Array(Schema.String),
  language: Schema.optionalKey(Schema.String),
  updatedAt: Schema.String
})
export type NoteSummary = typeof NoteSummary.Type

export const TagCount = Schema.Struct({
  tag: Schema.String,
  count: Schema.Number
})
export type TagCount = typeof TagCount.Type

export const WorkspaceStats = Schema.Struct({
  totalNotes: Schema.Number,
  byCategory: Schema.Record(NoteCategory, Schema.Number),
  tags: Schema.Array(TagCount)
})
export type WorkspaceStats = typeof WorkspaceStats.Type

export class NoteNotFoundError extends Schema.TaggedError<NoteNotFoundError>()("NoteNotFoundError", {
  id: Schema.String,
  message: Schema.String
}) {}

export class NoteAlreadyExistsError extends Schema.TaggedError<NoteAlreadyExistsError>()(
  "NoteAlreadyExistsError",
  {
    id: Schema.String,
    message: Schema.String
  }
) {}

export class InvalidNoteInputError extends Schema.TaggedError<InvalidNoteInputError>()(
  "InvalidNoteInputError",
  {
    field: Schema.String,
    message: Schema.String
  }
) {}

export const toNoteSummary = (note: Note): NoteSummary => ({
  id: note.id,
  title: note.title,
  category: note.category,
  tags: note.tags,
  ...(note.language !== undefined ? { language: note.language } : {}),
  updatedAt: note.updatedAt
})
