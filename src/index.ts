#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node"
import { Cause, Effect, Layer, Logger } from "effect"
import { StdioServerLayer } from "./mcp/server.js"

// Route all Effect logs to stderr and disable NodeRuntime's outer error reporter
// so stdout carries strictly valid newline-delimited JSON-RPC frames.
const main = Layer.launch(StdioServerLayer).pipe(
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError("MCP server failed", cause)
  ),
  Effect.provide(Layer.succeed(Logger.LogToStderr, true))
)

NodeRuntime.runMain(main, { disableErrorReporting: true })
