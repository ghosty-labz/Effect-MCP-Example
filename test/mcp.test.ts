import { Cause, Effect, Exit, Layer } from "effect"
import { McpSchema, McpTest } from "effect/ai"
import { describe, expect, it } from "vitest"
import { Protocols, RegistrationsLayer, ServerInfo } from "../src/mcp/server.js"
import { DefaultSeedNotes, NotesStoreLive } from "../src/store.js"

const withClient = <A, E>(
  run: (client: McpTest.Client) => Effect.Effect<A, E>,
  seed = DefaultSeedNotes
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const client = yield* McpTest.makeClient(
          RegistrationsLayer.pipe(Layer.provide(NotesStoreLive(seed))),
          {
            name: ServerInfo.name,
            version: ServerInfo.version,
            instructions: ServerInfo.instructions,
            protocols: Protocols
          }
        )
        return yield* run(client)
      })
    )
  )

const getFirstText = (content: ReadonlyArray<McpSchema.ContentBlock>): string => {
  const first = content[0]
  if (first === undefined || first.type !== "text") {
    throw new Error(`Expected text content block, received: ${JSON.stringify(first)}`)
  }
  return first.text
}

describe("MCP Server (in-memory via McpTest.makeClient)", () => {
  describe("tools", () => {
    it("advertises all tools with annotations and output schemas", async () => {
      const result = await withClient((client) => client.listTools())
      const byName = new Map(result.tools.map((tool) => [tool.name, tool]))

      expect(Array.from(byName.keys()).sort()).toEqual([
        "create_note",
        "delete_note",
        "get_note",
        "list_notes",
        "update_note"
      ])

      const listTool = byName.get("list_notes")
      expect(listTool?.annotations?.readOnlyHint).toBe(true)
      expect(listTool?.annotations?.idempotentHint).toBe(true)
      expect(listTool?.annotations?.destructiveHint).toBe(false)
      expect(listTool?.outputSchema).toBeDefined()

      const deleteTool = byName.get("delete_note")
      expect(deleteTool?.annotations?.readOnlyHint).toBe(false)
      expect(deleteTool?.annotations?.destructiveHint).toBe(true)
    })

    it("lists and filters seeded notes", async () => {
      const { all, snippets, byTag, byQuery } = await withClient((client) =>
        Effect.gen(function*() {
          const all = yield* client.callTool({ name: "list_notes", arguments: {} })
          const snippets = yield* client.callTool({
            name: "list_notes",
            arguments: { category: "snippet" }
          })
          const byTag = yield* client.callTool({
            name: "list_notes",
            arguments: { tag: "ARCHITECTURE" }
          })
          const byQuery = yield* client.callTool({
            name: "list_notes",
            arguments: { query: "LogToStderr" }
          })
          return { all, snippets, byTag, byQuery }
        })
      )

      expect(all.isError).not.toBe(true)
      expect(all.structuredContent).toMatchObject({ count: 3 })

      expect(snippets.structuredContent).toMatchObject({
        count: 1,
        notes: [expect.objectContaining({ id: "resource-template-snippet", category: "snippet" })]
      })

      expect(byTag.structuredContent).toMatchObject({
        count: 1,
        notes: [expect.objectContaining({ id: "add-persistence-layer" })]
      })

      expect(byQuery.structuredContent).toMatchObject({
        count: 1,
        notes: [expect.objectContaining({ id: "effect-v4-stdio-logging" })]
      })
    })

    it("gets an existing note and returns a typed tool error when missing", async () => {
      const { found, missing } = await withClient((client) =>
        Effect.gen(function*() {
          const found = yield* client.callTool({
            name: "get_note",
            arguments: { id: "effect-v4-stdio-logging" }
          })
          const missing = yield* client.callTool({
            name: "get_note",
            arguments: { id: "does-not-exist" }
          })
          return { found, missing }
        })
      )

      expect(found.isError).not.toBe(true)
      expect(found.structuredContent).toMatchObject({
        id: "effect-v4-stdio-logging",
        category: "decision"
      })

      expect(missing.isError).toBe(true)
      expect(getFirstText(missing.content)).toContain('Note "does-not-exist" was not found.')
    })

    it("supports create, update, and delete lifecycle plus typed error paths", async () => {
      const results = await withClient((client) =>
        Effect.gen(function*() {
          const created = yield* client.callTool({
            name: "create_note",
            arguments: {
              title: "Effect Layer Composition",
              content: "Provide shared services once at the application root.",
              category: "note",
              tags: ["Effect", "DI", "effect"]
            }
          })

          const duplicate = yield* client.callTool({
            name: "create_note",
            arguments: {
              id: "effect-layer-composition",
              title: "Duplicate",
              content: "Should fail with NoteAlreadyExistsError"
            }
          })

          const blankTitle = yield* client.callTool({
            name: "create_note",
            arguments: {
              title: "   ",
              content: "Body"
            }
          })

          const updated = yield* client.callTool({
            name: "update_note",
            arguments: {
              id: "effect-layer-composition",
              title: "Effect v4 Layer Composition",
              tags: ["effect", "layers"],
              language: "typescript"
            }
          })

          const deleted = yield* client.callTool({
            name: "delete_note",
            arguments: { id: "effect-layer-composition" }
          })

          const deleteAgain = yield* client.callTool({
            name: "delete_note",
            arguments: { id: "effect-layer-composition" }
          })

          return { created, duplicate, blankTitle, updated, deleted, deleteAgain }
        })
      )

      expect(results.created.isError).not.toBe(true)
      expect(results.created.structuredContent).toMatchObject({
        id: "effect-layer-composition",
        title: "Effect Layer Composition",
        category: "note",
        tags: ["di", "effect"]
      })

      expect(results.duplicate.isError).toBe(true)
      expect(getFirstText(results.duplicate.content)).toContain("already exists")

      expect(results.blankTitle.isError).toBe(true)
      expect(getFirstText(results.blankTitle.content)).toContain("Title must not be empty")

      expect(results.updated.isError).not.toBe(true)
      expect(results.updated.structuredContent).toMatchObject({
        id: "effect-layer-composition",
        title: "Effect v4 Layer Composition",
        tags: ["effect", "layers"],
        language: "typescript"
      })

      expect(results.deleted.isError).not.toBe(true)
      expect(results.deleted.structuredContent).toEqual({
        deleted: true,
        id: "effect-layer-composition"
      })

      expect(results.deleteAgain.isError).toBe(true)
      expect(getFirstText(results.deleteAgain.content)).toContain("was not found")
    })

    it("reports schema-invalid tool parameters as a tool execution error on MCP 2025-11-25 and InvalidParams on 2025-06-18", async () => {
      const modernResult = await withClient((client) =>
        client.callTool({
          name: "get_note",
          arguments: {}
        })
      )
      expect(modernResult.isError).toBe(true)
      expect(getFirstText(modernResult.content)).toContain("id")

      const legacyExit = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const client = yield* McpTest.makeClient(
              RegistrationsLayer.pipe(Layer.provide(NotesStoreLive())),
              {
                name: ServerInfo.name,
                version: ServerInfo.version,
                protocols: Protocols,
                protocolVersion: "2025-06-18"
              }
            )
            return yield* Effect.exit(
              client.callTool({
                name: "get_note",
                arguments: {}
              })
            )
          })
        )
      )

      expect(Exit.isFailure(legacyExit)).toBe(true)
      if (Exit.isFailure(legacyExit)) {
        const failure = Cause.findErrorOption(legacyExit.cause)
        expect(failure._tag).toBe("Some")
        if (failure._tag === "Some") {
          expect(failure.value.code).toBe(-32602)
        }
      }
    })
  })

  describe("resources", () => {
    it("lists static resources and parameterized resource templates", async () => {
      const { resources, templates } = await withClient((client) =>
        Effect.gen(function*() {
          const resources = yield* client.listResources()
          const templates = yield* client.listResourceTemplates()
          return { resources, templates }
        })
      )

      expect(resources.resources.map((r) => r.uri).sort()).toEqual([
        "notes://guide",
        "notes://index"
      ])
      expect(templates.resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
        "notes://item/{id}",
        "notes://tag/{tag}"
      ])
    })

    it("reads static resources and reflects live mutations in notes://index", async () => {
      const { guide, indexAfterCreate } = await withClient((client) =>
        Effect.gen(function*() {
          const guide = yield* client.readResource({ uri: "notes://guide" })
          yield* client.callTool({
            name: "create_note",
            arguments: {
              id: "live-check",
              title: "Live Resource Check",
              content: "Visible immediately via notes://index",
              category: "note",
              tags: ["live"]
            }
          })
          const indexAfterCreate = yield* client.readResource({ uri: "notes://index" })
          return { guide, indexAfterCreate }
        })
      )

      const guideBlock = guide.contents[0]
      expect(guideBlock && "text" in guideBlock ? guideBlock.text : "").toContain(
        "Developer Notes Workspace Guide"
      )

      const indexBlock = indexAfterCreate.contents[0]
      const indexJson = JSON.parse(indexBlock && "text" in indexBlock ? indexBlock.text : "{}")
      expect(indexJson.stats.totalNotes).toBe(4)
      expect(indexJson.notes.some((n: { id: string }) => n.id === "live-check")).toBe(true)
    })

    it("reads parameterized item and tag templates and handles missing notes", async () => {
      const { item, byTag, missingExit, idCompletions, tagCompletions } = await withClient(
        (client) =>
          Effect.gen(function*() {
            const item = yield* client.readResource({
              uri: "notes://item/resource-template-snippet"
            })
            const byTag = yield* client.readResource({
              uri: "notes://tag/mcp"
            })
            const missingExit = yield* Effect.exit(
              client.readResource({ uri: "notes://item/unknown-note" })
            )
            const idCompletions = yield* client.complete({
              ref: McpSchema.ResourceReference.make({ uri: "notes://item/{id}" }),
              argument: { name: "id", value: "effect" },
              context: { arguments: {} }
            })
            const tagCompletions = yield* client.complete({
              ref: McpSchema.ResourceReference.make({ uri: "notes://tag/{tag}" }),
              argument: { name: "tag", value: "m" },
              context: { arguments: {} }
            })
            return { item, byTag, missingExit, idCompletions, tagCompletions }
          })
      )

      const itemBlock = item.contents[0]
      const parsedItem = JSON.parse(itemBlock && "text" in itemBlock ? itemBlock.text : "{}")
      expect(parsedItem).toMatchObject({
        id: "resource-template-snippet",
        language: "typescript"
      })

      const tagBlock = byTag.contents[0]
      const parsedTag = JSON.parse(tagBlock && "text" in tagBlock ? tagBlock.text : "{}")
      expect(parsedTag.tag).toBe("mcp")
      expect(parsedTag.count).toBe(2)

      expect(Exit.isFailure(missingExit)).toBe(true)
      if (Exit.isFailure(missingExit)) {
        const err = Cause.findErrorOption(missingExit.cause)
        expect(err._tag).toBe("Some")
        if (err._tag === "Some") {
          expect(err.value.message).toContain('Note "unknown-note" was not found.')
        }
      }

      expect(idCompletions.completion.values).toEqual(["effect-v4-stdio-logging"])
      expect(tagCompletions.completion.values).toEqual(["mcp"])
    })
  })

  describe("prompts", () => {
    it("lists prompts, renders parameterized messages, and supports argument completion", async () => {
      const { listed, review, summary, missingExit, focusCompletions } = await withClient(
        (client) =>
          Effect.gen(function*() {
            const listed = yield* client.listPrompts()
            const review = yield* client.getPrompt({
              name: "review_note",
              arguments: {
                id: "resource-template-snippet",
                focus: "correctness"
              }
            })
            const summary = yield* client.getPrompt({
              name: "summarize_workspace",
              arguments: {
                category: "decision",
                style: "detailed"
              }
            })
            const missingExit = yield* Effect.exit(
              client.getPrompt({
                name: "review_note",
                arguments: { id: "nonexistent" }
              })
            )
            const focusCompletions = yield* client.complete({
              ref: McpSchema.PromptReference.make({ name: "review_note" }),
              argument: { name: "focus", value: "c" },
              context: { arguments: {} }
            })
            return { listed, review, summary, missingExit, focusCompletions }
          })
      )

      expect(listed.prompts.map((p) => p.name).sort()).toEqual([
        "review_note",
        "summarize_workspace"
      ])

      expect(review.messages).toHaveLength(1)
      const reviewMsg = review.messages[0]
      expect(reviewMsg?.role).toBe("user")
      expect(reviewMsg?.content.type).toBe("text")
      if (reviewMsg?.content.type === "text") {
        expect(reviewMsg.content.text).toContain("focus on **correctness**")
        expect(reviewMsg.content.text).toContain("```typescript")
        expect(reviewMsg.content.text).toContain("resource-template-snippet")
      }

      expect(summary.messages).toHaveLength(1)
      const summaryMsg = summary.messages[0]
      if (summaryMsg?.content.type === "text") {
        expect(summaryMsg.content.text).toContain('detailed engineering summary of category "decision"')
        expect(summaryMsg.content.text).toContain("effect-v4-stdio-logging")
      }

      expect(Exit.isFailure(missingExit)).toBe(true)
      expect([...focusCompletions.completion.values].sort()).toEqual(["clarity", "correctness"])
    })
  })
})
