import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { createInterface } from "node:readline"
import { describe, expect, it } from "vitest"

interface JsonRpcResponse {
  readonly jsonrpc: "2.0"
  readonly id?: number | string | null
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown }
}

class StdioMcpHarness {
  readonly child: ChildProcessWithoutNullStreams
  readonly rawStdoutLines: Array<string> = []
  readonly stderrChunks: Array<string> = []
  private readonly pending = new Map<
    number,
    {
      readonly resolve: (value: JsonRpcResponse) => void
      readonly reject: (reason: unknown) => void
    }
  >()
  private nextId = 1

  constructor(entryPath: string) {
    this.child = spawn(process.execPath, [entryPath], {
      stdio: ["pipe", "pipe", "pipe"]
    })

    const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    rl.on("line", (line) => {
      if (line.length === 0) return
      this.rawStdoutLines.push(line)

      let parsed: JsonRpcResponse
      try {
        parsed = JSON.parse(line) as JsonRpcResponse
      } catch (err) {
        for (const waiter of this.pending.values()) {
          waiter.reject(new Error(`Non-JSON line written to stdout: ${JSON.stringify(line)} (${String(err)})`))
        }
        this.pending.clear()
        return
      }

      if (typeof parsed.id === "number") {
        const waiter = this.pending.get(parsed.id)
        if (waiter !== undefined) {
          this.pending.delete(parsed.id)
          waiter.resolve(parsed)
        }
      }
    })

    this.child.stderr.setEncoding("utf8")
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk)
    })

    this.child.on("exit", (code, signal) => {
      if (this.pending.size > 0) {
        const stderr = this.stderrChunks.join("")
        for (const waiter of this.pending.values()) {
          waiter.reject(
            new Error(
              `Server exited prematurely (code=${String(code)}, signal=${String(signal)}). stderr:\n${stderr}`
            )
          )
        }
        this.pending.clear()
      }
    })
  }

  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++
    const frame = {
      jsonrpc: "2.0" as const,
      id,
      method,
      ...(params !== undefined ? { params } : {})
    }

    return new Promise<JsonRpcResponse>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectPromise(new Error(`Timed out waiting for response to ${method} (id=${id})`))
      }, 5_000)

      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer)
          resolvePromise(response)
        },
        reject: (reason) => {
          clearTimeout(timer)
          rejectPromise(reason)
        }
      })

      this.child.stdin.write(`${JSON.stringify(frame)}\n`)
    })
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const frame = {
      jsonrpc: "2.0" as const,
      method,
      ...(params !== undefined ? { params } : {})
    }
    this.child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  closeAndWaitForExit(): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL")
        rejectPromise(new Error("Timed out waiting for stdio server to exit after stdin EOF"))
      }, 5_000)

      this.child.once("close", (code, signal) => {
        clearTimeout(timer)
        resolvePromise({ code, signal })
      })

      this.child.stdin.end()
    })
  }
}

describe("MCP Server (end-to-end stdio subprocess)", () => {
  it("completes initialize, tools, resources, prompts, keeps stdout strict JSON-RPC, and exits cleanly on EOF", async () => {
    const entryPath = resolve(process.cwd(), "dist/index.js")
    expect(existsSync(entryPath), "Run `npm run build` before running the stdio e2e test").toBe(true)

    const harness = new StdioMcpHarness(entryPath)

    try {
      const init = await harness.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "stdio-e2e-test", version: "1.0.0" }
      })
      expect(init.error).toBeUndefined()
      expect(init.result).toMatchObject({
        protocolVersion: "2025-11-25",
        serverInfo: {
          name: "effect-mcp-example",
          version: "1.0.0"
        },
        capabilities: {
          tools: expect.any(Object),
          resources: expect.any(Object),
          prompts: expect.any(Object)
        }
      })

      harness.notify("notifications/initialized")

      const toolsList = await harness.request("tools/list")
      expect(toolsList.error).toBeUndefined()
      const tools = (toolsList.result as { tools: Array<{ name: string }> }).tools
      expect(tools.map((t) => t.name).sort()).toEqual([
        "create_note",
        "delete_note",
        "get_note",
        "list_notes",
        "update_note"
      ])

      const createRes = await harness.request("tools/call", {
        name: "create_note",
        arguments: {
          id: "stdio-smoke-note",
          title: "Stdio Smoke Test",
          content: "Created over live NDJSON-RPC stdio transport.",
          category: "note",
          tags: ["e2e", "stdio"]
        }
      })
      expect(createRes.error).toBeUndefined()
      expect(createRes.result).toMatchObject({
        structuredContent: {
          id: "stdio-smoke-note",
          title: "Stdio Smoke Test"
        }
      })

      const missingRes = await harness.request("tools/call", {
        name: "get_note",
        arguments: { id: "no-such-note" }
      })
      expect(missingRes.error).toBeUndefined()
      expect(missingRes.result).toMatchObject({ isError: true })

      const resourcesList = await harness.request("resources/list")
      expect(resourcesList.error).toBeUndefined()
      const resources = (resourcesList.result as { resources: Array<{ uri: string }> }).resources
      expect(resources.map((r) => r.uri)).toContain("notes://index")

      const templatesList = await harness.request("resources/templates/list")
      expect(templatesList.error).toBeUndefined()
      const templates = (
        templatesList.result as { resourceTemplates: Array<{ uriTemplate: string }> }
      ).resourceTemplates
      expect(templates.map((t) => t.uriTemplate)).toContain("notes://item/{id}")

      const readIndex = await harness.request("resources/read", { uri: "notes://index" })
      expect(readIndex.error).toBeUndefined()
      const indexText = (readIndex.result as { contents: Array<{ text: string }> }).contents[0]?.text ?? "{}"
      expect(JSON.parse(indexText).stats.totalNotes).toBe(4)

      const readItem = await harness.request("resources/read", {
        uri: "notes://item/stdio-smoke-note"
      })
      expect(readItem.error).toBeUndefined()
      const itemText = (readItem.result as { contents: Array<{ text: string }> }).contents[0]?.text ?? "{}"
      expect(JSON.parse(itemText)).toMatchObject({
        id: "stdio-smoke-note",
        title: "Stdio Smoke Test"
      })

      const promptsList = await harness.request("prompts/list")
      expect(promptsList.error).toBeUndefined()
      const prompts = (promptsList.result as { prompts: Array<{ name: string }> }).prompts
      expect(prompts.map((p) => p.name).sort()).toEqual(["review_note", "summarize_workspace"])

      const promptGet = await harness.request("prompts/get", {
        name: "review_note",
        arguments: { id: "stdio-smoke-note", focus: "action-items" }
      })
      expect(promptGet.error).toBeUndefined()
      const messages = (
        promptGet.result as { messages: Array<{ role: string; content: { type: string; text: string } }> }
      ).messages
      expect(messages[0]?.role).toBe("user")
      expect(messages[0]?.content.text).toContain("Stdio Smoke Test")
      expect(messages[0]?.content.text).toContain("action-items")

      const exit = await harness.closeAndWaitForExit()
      expect(exit.signal).toBeNull()
      expect(exit.code).toBe(0)

      // Every non-empty line emitted to stdout must be a valid JSON-RPC 2.0 frame.
      expect(harness.rawStdoutLines.length).toBeGreaterThanOrEqual(10)
      for (const line of harness.rawStdoutLines) {
        const frame = JSON.parse(line) as { jsonrpc?: unknown }
        expect(frame.jsonrpc).toBe("2.0")
      }
    } finally {
      if (harness.child.exitCode === null && harness.child.signalCode === null) {
        harness.child.kill("SIGKILL")
      }
    }
  })
})
