// Affinity's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts.
import { afterEach, describe, expect, test } from "bun:test"
import { watchAccount } from "../../src/account.js"
import { PLUGIN_ID as AFFINITY_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { KNOWN_READS, NEXT_STEPS, PLUGIN_ID, shapeResult, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { DENIED_TOOLS, READ_TOOLS, WORKFLOW_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"
import { defaultRules } from "../../src/permissions.js"

const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})

describe("Affinity's tools RPC", () => {
  test("is affinity.crm.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(AFFINITY_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("affinity.crm.tools")
  })

  test("its methods are exactly the known reads, the server tools the default rules allow", () => {
    expect([...KNOWN_READS]).toEqual([...READ_TOOLS])
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    expect(KNOWN_READS.map((name) => `${SERVER_NAME}_${name}`)).toEqual(allowed)
  })

  test("Affinity's workflow playbooks are methods, and no write, denied tool or unknown tool is", () => {
    for (const name of WORKFLOW_TOOLS) expect(KNOWN_READS).toContain(name)
    expect(KNOWN_READS.filter((name) => WRITE_TOOLS.includes(name) || DENIED_TOOLS.includes(name))).toEqual([])
    expect(KNOWN_READS).not.toContain("send_feedback")
    for (const name of DENIED_TOOLS) expect(defaultRules()).toContainEqual({ action: `affinity_${name}`, resource: "*", effect: "deny" })
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(KNOWN_READS).not.toContain(name)
  })

  test("names Affinity's own commands in its next steps, and has no per-account servers", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect and choose Affinity")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.affinity")
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("if Affinity shows an error page instead, run /affinity-status for the admin step")
    expect(NEXT_STEPS.TOOL_UNAVAILABLE).toBe("Call describe to see which methods OpenCode lists now, and run /affinity-status.")
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
    const result = { output: { tenant: { id: "t_fake", name: "Northwind Capital" }, user: { id: "u_fake" }, grant: { type: "access-token", scopes: ["mcp.read"] } }, text: "{}" }
    expect(shapeResult("search_persons", result)).toBe(result)
    expect(account.current()).toBeUndefined()
    expect(shapeResult("get_current_user", result)).toBe(result)
    expect(account.current()).toEqual({ organisation: "Northwind Capital", grant: "read-only" })
  })
})
