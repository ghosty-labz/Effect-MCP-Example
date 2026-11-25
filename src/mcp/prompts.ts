import { Effect, Layer, Schema } from "effect"
import { McpSchema, McpServer } from "effect/ai"
import { NoteCategory } from "../domain.js"
import { NotesStore } from "../store.js"

const ReviewFocus = Schema.Literals(["clarity", "correctness", "action-items"]).annotate({
  description: "Optional review angle to emphasize"
})

const SummaryStyle = Schema.Literals(["brief", "detailed"]).annotate({
  description: "Summary verbosity level"
})

const REVIEW_FOCUS_OPTIONS: ReadonlyArray<typeof ReviewFocus.Type> = [
  "clarity",
  "correctness",
  "action-items"
]

const SUMMARY_STYLE_OPTIONS: ReadonlyArray<typeof SummaryStyle.Type> = ["brief", "detailed"]

const CATEGORY_OPTIONS: ReadonlyArray<NoteCategory> = ["note", "snippet", "decision", "todo"]

export const PromptsLayer = Layer.unwrap(
  Effect.gen(function*() {
    const store = yield* NotesStore

    const reviewNotePrompt = McpServer.prompt({
      name: "review_note",
      title: "Review Note",
      description: "Build a structured prompt to review an existing workspace note or code snippet.",
      parameters: {
        id: Schema.String.annotate({ description: "Slug ID of the note to review" }),
        focus: Schema.optionalKey(ReviewFocus)
      },
      completion: {
        id: (input) =>
          Effect.map(store.listIds(), (ids) => {
            const prefix = input.trim().toLowerCase()
            return ids.filter((id) => id.startsWith(prefix))
          }),
        focus: (input) => {
          const prefix = input.trim().toLowerCase()
          return Effect.succeed(REVIEW_FOCUS_OPTIONS.filter((opt) => opt.startsWith(prefix)))
        }
      },
      content: Effect.fn("prompt.review_note")(function*({ id, focus }) {
        const note = yield* store.get(id)
        const angle = focus ?? "clarity"
        const codeFence = note.language !== undefined ? `\`\`\`${note.language}\n${note.content}\n\`\`\`` : note.content

        return [
          McpSchema.PromptMessage.make({
            role: "user",
            content: McpSchema.TextContent.make({
              text: [
                `Please review the following workspace ${note.category} with a focus on **${angle}**.`,
                "",
                `Title: ${note.title}`,
                `ID: ${note.id}`,
                `Tags: ${note.tags.length > 0 ? note.tags.join(", ") : "(none)"}`,
                "",
                codeFence,
                "",
                "Provide concrete, actionable suggestions."
              ].join("\n")
            })
          })
        ]
      })
    })

    const summarizeWorkspacePrompt = McpServer.prompt({
      name: "summarize_workspace",
      title: "Summarize Workspace",
      description: "Generate a structured summary prompt over notes currently stored in the workspace.",
      parameters: {
        category: Schema.optionalKey(NoteCategory),
        style: Schema.optionalKey(SummaryStyle)
      },
      completion: {
        category: (input) => {
          const prefix = input.trim().toLowerCase()
          return Effect.succeed(CATEGORY_OPTIONS.filter((opt) => opt.startsWith(prefix)))
        },
        style: (input) => {
          const prefix = input.trim().toLowerCase()
          return Effect.succeed(SUMMARY_STYLE_OPTIONS.filter((opt) => opt.startsWith(prefix)))
        }
      },
      content: Effect.fn("prompt.summarize_workspace")(function*({ category, style }) {
        const notes = yield* store.list(category !== undefined ? { category } : undefined)
        const verbosity = style ?? "brief"
        const scopeLabel = category !== undefined ? `category "${category}"` : "the full workspace"

        const formattedNotes =
          notes.length === 0
            ? "_No notes match the selected filter._"
            : notes
                .map(
                  (note) =>
                    `### ${note.title} (\`${note.id}\` — ${note.category})\nTags: ${
                      note.tags.length > 0 ? note.tags.join(", ") : "none"
                    }\n\n${note.content}`
                )
                .join("\n\n---\n\n")

        return [
          McpSchema.PromptMessage.make({
            role: "user",
            content: McpSchema.TextContent.make({
              text: [
                `Write a ${verbosity} engineering summary of ${scopeLabel} (${notes.length} note${notes.length === 1 ? "" : "s"}).`,
                "Highlight key decisions, reusable snippets, and open todos.",
                "",
                formattedNotes
              ].join("\n")
            })
          })
        ]
      })
    })

    return Layer.mergeAll(reviewNotePrompt, summarizeWorkspacePrompt)
  })
)
