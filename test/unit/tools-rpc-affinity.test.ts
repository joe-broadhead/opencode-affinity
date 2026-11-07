// Affinity's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts. The methods come from src/affinity-tools.ts, the same table the reconcile fixture pins, so
// replacing test/unit/affinity-tools-list.json with a live list updates both in one step.
import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { watchAccount } from "../../src/account.js"
import { DENIED_TOOLS, READ_TOOLS, WORKFLOW_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"
import { PLUGIN_ID as AFFINITY_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { METHODS, NEXT_STEPS, PLUGIN_ID, pluginError, shapeInput, shapeResult, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { defaultRules } from "../../src/permissions.js"

interface Recorded {
  readonly name: string
  readonly annotations: { readonly readOnlyHint: boolean; readonly destructiveHint: boolean }
}
const RECORDED = (JSON.parse(readFileSync(new URL("./affinity-tools-list.json", import.meta.url), "utf8")) as { tools: Recorded[] }).tools
const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})

const CLASS_OF = new Map<string, string>([
  ...READ_TOOLS.filter((name) => !WORKFLOW_TOOLS.includes(name)).map((name) => [name, "read"] as const),
  ...WORKFLOW_TOOLS.map((name) => [name, "send"] as const),
  ...WRITE_TOOLS.map((name) => [name, "write"] as const),
  ...DENIED_TOOLS.map((name) => [name, "destructive"] as const),
])

describe("Affinity's tools RPC", () => {
  test("is affinity.crm.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(AFFINITY_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("affinity.crm.tools")
  })

  test("its methods are every known tool by exact name, the same list the fixture reconciles to", () => {
    const names = METHODS.map((method) => method.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(RECORDED.map((tool) => tool.name).sort())
    expect([...names].sort()).toEqual([...READ_TOOLS, ...WORKFLOW_TOOLS, ...WRITE_TOOLS, ...DENIED_TOOLS].filter((name, index, all) => all.indexOf(name) === index).sort())
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(names).not.toContain(name)
    for (const method of METHODS) expect(method.kind).toBe("mcp")
  })

  test("gives each method its class: reads, the twelve workflow playbooks as sends, writes, and the ten denied tools", () => {
    for (const method of METHODS) expect(CLASS_OF.get(method.name)).toBe(method.class)
    for (const name of WORKFLOW_TOOLS) expect(METHODS.find((method) => method.name === name)!.class).toBe("send")
    expect(METHODS.filter((method) => method.class === "send")).toHaveLength(WORKFLOW_TOOLS.length)
    expect(METHODS.filter((method) => method.class === "destructive")).toHaveLength(DENIED_TOOLS.length)
  })

  test("its classes agree with the fixture's annotations, and the default rules' effects", () => {
    for (const tool of RECORDED) {
      const method = METHODS.find((entry) => entry.name === tool.name)!
      // A read-only tool never changes anything; a tool that is not read-only is never a read or a playbook.
      if (method.class === "read") expect(tool.annotations.readOnlyHint).toBe(true)
      if (!tool.annotations.readOnlyHint) expect(["write", "destructive"]).toContain(method.class)
    }
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    const denied = defaultRules().filter((rule) => rule.effect === "deny").map((rule) => rule.action)
    for (const method of METHODS) {
      const action = `${SERVER_NAME}_${method.name}`
      if (method.class === "read" || method.class === "send") expect(allowed).toContain(action)
      if (method.class === "destructive") expect(denied).toContain(action)
    }
  })

  test("names Affinity's own commands in its next steps, the location header, and no per-account servers", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect and choose Affinity")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.affinity")
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("if Affinity shows an error page instead, run /affinity-status for the admin step")
    expect(NEXT_STEPS.TOOL_UNAVAILABLE).toBe("Call describe to see which methods OpenCode lists now, and run /affinity-status.")
    expect(NEXT_STEPS.SESSION_UNKNOWN).toContain("x-opencode-directory")
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
  })

  test("a script's account read reaches status, and the result passes through unchanged", async () => {
    const never = { subscribe: ({ signal }: { signal: AbortSignal }) => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ done: true, value: undefined }))) }) }) }
    const account = await watchAccount({
      tool: { hook: async () => ({ dispose: async () => {} }) },
      mcp: { list: async () => ({ data: [] }) },
      event: never,
    } as never)
    stops.push(account.stop)
    const call = { sessionID: "ses_1", agent: "build", action: `${SERVER_NAME}_get_current_user` }
    const input = { person_id: 1 }
    expect(shapeInput("search_persons", input, call)).toBe(input)
    const result = { output: { tenant: { id: "t_fake", name: "Northwind Capital" }, user: { id: "u_fake" }, grant: { type: "access-token", scopes: ["mcp.read"] } }, text: "{}" }
    expect(shapeResult("search_persons", result, call)).toBe(result)
    expect(account.current()).toBeUndefined()
    expect(shapeResult("get_current_user", result, call)).toBe(result)
    expect(account.current()).toEqual({ organisation: "Northwind Capital", grant: "read-only" })
    expect(pluginError(new Error("boom"))).toBeUndefined()
  })
})
