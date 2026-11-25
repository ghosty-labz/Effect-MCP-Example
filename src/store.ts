import { Clock, Context, Effect, Layer, Ref } from "effect"
import {
  InvalidNoteInputError,
  type Note,
  NoteAlreadyExistsError,
  type NoteCategory,
  NoteNotFoundError,
  type TagCount,
  type WorkspaceStats
} from "./domain.js"

export interface ListNotesFilter {
  readonly category?: NoteCategory | undefined
  readonly tag?: string | undefined
  readonly query?: string | undefined
}

export interface CreateNoteInput {
  readonly id?: string | undefined
  readonly title: string
  readonly content: string
  readonly category?: NoteCategory | undefined
  readonly tags?: ReadonlyArray<string> | undefined
  readonly language?: string | undefined
}

export interface UpdateNoteInput {
  readonly id: string
  readonly title?: string | undefined
  readonly content?: string | undefined
  readonly category?: NoteCategory | undefined
  readonly tags?: ReadonlyArray<string> | undefined
  readonly language?: string | undefined
}

export interface NotesStoreService {
  readonly list: (filter?: ListNotesFilter) => Effect.Effect<ReadonlyArray<Note>>
  readonly get: (id: string) => Effect.Effect<Note, NoteNotFoundError>
  readonly create: (
    input: CreateNoteInput
  ) => Effect.Effect<Note, NoteAlreadyExistsError | InvalidNoteInputError>
  readonly update: (
    input: UpdateNoteInput
  ) => Effect.Effect<Note, NoteNotFoundError | InvalidNoteInputError>
  readonly remove: (id: string) => Effect.Effect<void, NoteNotFoundError>
  readonly listIds: () => Effect.Effect<ReadonlyArray<string>>
  readonly listTags: () => Effect.Effect<ReadonlyArray<TagCount>>
  readonly stats: () => Effect.Effect<WorkspaceStats>
}

export class NotesStore extends Context.Service<NotesStore, NotesStoreService>()(
  "effect-mcp-example/NotesStore"
) {}

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const normalizeTags = (tags: ReadonlyArray<string> | undefined): ReadonlyArray<string> => {
  if (tags === undefined) return []
  const unique = new Set<string>()
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase()
    if (normalized.length > 0) unique.add(normalized)
  }
  return Array.from(unique).sort()
}

const VALID_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const DefaultSeedNotes: ReadonlyArray<Note> = [
  {
    id: "effect-v4-stdio-logging",
    title: "Keep stdout clean in stdio MCP servers",
    content: [
      "MCP stdio transports exchange newline-delimited JSON-RPC over stdout.",
      "Route Effect logs to stderr with `Layer.succeed(Logger.LogToStderr, true)`",
      "and run `NodeRuntime.runMain(main, { disableErrorReporting: true })` so",
      "startup or fiber failures never corrupt stdout framing."
    ].join("\n"),
    category: "decision",
    tags: ["effect", "mcp", "stdio"],
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T10:00:00.000Z"
  },
  {
    id: "resource-template-snippet",
    title: "Effect v4 parameterized MCP resource template",
    content: [
      "const NoteIdParam = McpSchema.param(\"id\", Schema.String)",
      "",
      "McpServer.resource`notes://item/${NoteIdParam}`({",
      "  name: \"Note by ID\",",
      "  mimeType: \"application/json\",",
      "  content: (_uri, id) => store.get(id).pipe(Effect.map((n) => JSON.stringify(n, null, 2)))",
      "})"
    ].join("\n"),
    category: "snippet",
    tags: ["effect", "mcp", "resources"],
    language: "typescript",
    createdAt: "2026-01-16T14:30:00.000Z",
    updatedAt: "2026-01-16T14:30:00.000Z"
  },
  {
    id: "add-persistence-layer",
    title: "Follow-up: swap in-memory Ref for SQLite or file store",
    content: [
      "Because all MCP tools, resources, and prompts depend on the `NotesStore`",
      "service tag, persistence can be swapped by providing an alternate `Layer`",
      "without changing any MCP handlers."
    ].join("\n"),
    category: "todo",
    tags: ["architecture", "effect"],
    createdAt: "2026-01-17T09:15:00.000Z",
    updatedAt: "2026-01-17T09:15:00.000Z"
  }
]

const makeNotesStore = (seed: ReadonlyArray<Note>): Effect.Effect<NotesStoreService> =>
  Effect.gen(function*() {
    const initial = new Map<string, Note>(seed.map((note) => [note.id, note]))
    const state = yield* Ref.make<ReadonlyMap<string, Note>>(initial)

    const nowIso = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString())

    const list: NotesStoreService["list"] = Effect.fn("NotesStore.list")(function*(filter) {
      const notes = yield* Ref.get(state)
      const normalizedTag = filter?.tag?.trim().toLowerCase()
      const normalizedQuery = filter?.query?.trim().toLowerCase()

      return Array.from(notes.values())
        .filter((note) => {
          if (filter?.category !== undefined && note.category !== filter.category) {
            return false
          }
          if (normalizedTag !== undefined && normalizedTag.length > 0 && !note.tags.includes(normalizedTag)) {
            return false
          }
          if (normalizedQuery !== undefined && normalizedQuery.length > 0) {
            const haystack = `${note.id} ${note.title} ${note.content} ${note.tags.join(" ")}`.toLowerCase()
            if (!haystack.includes(normalizedQuery)) {
              return false
            }
          }
          return true
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    })

    const get: NotesStoreService["get"] = Effect.fn("NotesStore.get")(function*(id) {
      const notes = yield* Ref.get(state)
      const note = notes.get(id)
      if (note === undefined) {
        return yield* new NoteNotFoundError({
          id,
          message: `Note "${id}" was not found.`
        })
      }
      return note
    })

    const create: NotesStoreService["create"] = Effect.fn("NotesStore.create")(function*(input) {
      const title = input.title.trim()
      if (title.length === 0) {
        return yield* new InvalidNoteInputError({
          field: "title",
          message: "Title must not be empty."
        })
      }

      const content = input.content.trim()
      if (content.length === 0) {
        return yield* new InvalidNoteInputError({
          field: "content",
          message: "Content must not be empty."
        })
      }

      const id = input.id !== undefined ? input.id.trim().toLowerCase() : slugify(title)
      if (id.length === 0 || !VALID_ID_PATTERN.test(id)) {
        return yield* new InvalidNoteInputError({
          field: "id",
          message: "Note id must be a non-empty lowercase slug (letters, digits, and single hyphens)."
        })
      }

      const language = input.language?.trim()
      const timestamp = yield* nowIso
      const note: Note = {
        id,
        title,
        content,
        category: input.category ?? "note",
        tags: normalizeTags(input.tags),
        ...(language !== undefined && language.length > 0 ? { language } : {}),
        createdAt: timestamp,
        updatedAt: timestamp
      }

      const created = yield* Ref.modify(state, (current) => {
        if (current.has(id)) {
          return [false, current] as const
        }
        const next = new Map(current)
        next.set(id, note)
        return [true, next] as const
      })

      if (!created) {
        return yield* new NoteAlreadyExistsError({
          id,
          message: `Note "${id}" already exists.`
        })
      }

      return note
    })

    const update: NotesStoreService["update"] = Effect.fn("NotesStore.update")(function*(input) {
      if (input.title !== undefined && input.title.trim().length === 0) {
        return yield* new InvalidNoteInputError({
          field: "title",
          message: "Title must not be empty."
        })
      }
      if (input.content !== undefined && input.content.trim().length === 0) {
        return yield* new InvalidNoteInputError({
          field: "content",
          message: "Content must not be empty."
        })
      }

      const timestamp = yield* nowIso
      const updated = yield* Ref.modify(state, (current) => {
        const existing = current.get(input.id)
        if (existing === undefined) {
          return [undefined, current] as const
        }

        const nextLanguage =
          input.language !== undefined
            ? input.language.trim().length > 0
              ? input.language.trim()
              : undefined
            : existing.language

        const nextNote: Note = {
          id: existing.id,
          title: input.title !== undefined ? input.title.trim() : existing.title,
          content: input.content !== undefined ? input.content.trim() : existing.content,
          category: input.category ?? existing.category,
          tags: input.tags !== undefined ? normalizeTags(input.tags) : existing.tags,
          ...(nextLanguage !== undefined ? { language: nextLanguage } : {}),
          createdAt: existing.createdAt,
          updatedAt: timestamp
        }

        const nextMap = new Map(current)
        nextMap.set(existing.id, nextNote)
        return [nextNote, nextMap] as const
      })

      if (updated === undefined) {
        return yield* new NoteNotFoundError({
          id: input.id,
          message: `Note "${input.id}" was not found.`
        })
      }

      return updated
    })

    const remove: NotesStoreService["remove"] = Effect.fn("NotesStore.remove")(function*(id) {
      const deleted = yield* Ref.modify(state, (current) => {
        if (!current.has(id)) {
          return [false, current] as const
        }
        const next = new Map(current)
        next.delete(id)
        return [true, next] as const
      })

      if (!deleted) {
        return yield* new NoteNotFoundError({
          id,
          message: `Note "${id}" was not found.`
        })
      }
    })

    const listIds: NotesStoreService["listIds"] = Effect.fn("NotesStore.listIds")(function*() {
      const notes = yield* Ref.get(state)
      return Array.from(notes.keys()).sort()
    })

    const listTags: NotesStoreService["listTags"] = Effect.fn("NotesStore.listTags")(function*() {
      const notes = yield* Ref.get(state)
      const counts = new Map<string, number>()
      for (const note of notes.values()) {
        for (const tag of note.tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1)
        }
      }
      return Array.from(counts.entries())
        .map(([tag, count]): TagCount => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    })

    const stats: NotesStoreService["stats"] = Effect.fn("NotesStore.stats")(function*() {
      const notes = yield* Ref.get(state)
      const tags = yield* listTags()
      const byCategory: Record<NoteCategory, number> = {
        note: 0,
        snippet: 0,
        decision: 0,
        todo: 0
      }
      for (const note of notes.values()) {
        byCategory[note.category] += 1
      }
      return {
        totalNotes: notes.size,
        byCategory,
        tags
      }
    })

    return NotesStore.of({
      list,
      get,
      create,
      update,
      remove,
      listIds,
      listTags,
      stats
    })
  })

export const NotesStoreLive = (
  seed: ReadonlyArray<Note> = DefaultSeedNotes
): Layer.Layer<NotesStore> => Layer.effect(NotesStore, makeNotesStore(seed))

export const NotesStoreEmpty: Layer.Layer<NotesStore> = NotesStoreLive([])
