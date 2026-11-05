// The account capture: the organisation's name and the grant from a get_current_user result, kept in memory and
// forgotten on sign-out.
import { afterEach, describe, expect, test } from "bun:test"
import { accountOf, captureAccount, watchAccount } from "../../src/account.js"

type Event = { type: string; data: { server?: string } }

/** An event stream the test drives, ended by the subscriber's signal. */
function events() {
  const listeners = new Set<(event: Event) => void>()
  const subscribe = ({ signal }: { signal: AbortSignal }) => {
    const queue: Event[] = []
    let wake: (() => void) | undefined
    const listener = (event: Event) => (queue.push(event), wake?.())
    listeners.add(listener)
    signal.addEventListener("abort", () => (listeners.delete(listener), wake?.()))
    return {
      async *[Symbol.asyncIterator]() {
        while (!signal.aborted) {
          if (queue.length) yield queue.shift()!
          else await new Promise<void>((resolve) => (wake = resolve))
        }
      },
    }
  }
  return { subscribe, emit: (type: string, data: Event["data"] = {}) => listeners.forEach((listener) => listener({ type, data })) }
}

/** Affinity's whoami shape, with invented values. */
const RESULT = {
  tenant: { id: "tenant_fake_1", name: "Northwind\u0007 Capital", subdomain: "northwind-fake" },
  user: { id: "u_fake_1", firstName: "Jane", lastName: "Doe", emailAddress: "jane@example.com" },
  grant: { type: "access-token", scopes: ["mcp", "mcp.read", "offline_access"], createdAt: "2026-01-01T00:00:00Z" },
}
const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

async function watch() {
  const stream = events()
  let after: ((event: unknown) => Promise<void> | void) | undefined
  const state = { server: "connected" }
  const account = await watchAccount({
    tool: { hook: async (_name: string, callback: (event: unknown) => void) => ((after = callback), { dispose: async () => void (after = undefined) }) },
    mcp: { list: async () => ({ data: [{ name: "affinity", status: { status: state.server } }] }) },
    event: { subscribe: stream.subscribe },
  } as never)
  stops.push(account.stop)
  return { account, state, stream, after: async (event: unknown) => await after?.(event) }
}

describe("accountOf", () => {
  test("reads the organisation's name and the grant, and nothing else", () => {
    const expected = { organisation: "Northwind Capital", grant: "read-write" } as const
    expect(accountOf({ output: RESULT })).toEqual(expected)
    expect(accountOf({ content: [{ type: "text", text: JSON.stringify(RESULT) }] })).toEqual(expected)
    expect(accountOf({ output: { data: { tenant: { name: "Globex Ventures" }, grant: { type: "access-token", scopes: ["mcp.read"] } } } })).toEqual({ organisation: "Globex Ventures", grant: "read-only" })
    expect(JSON.stringify(accountOf({ output: RESULT }))).not.toMatch(/Jane|Doe|jane@|tenant_fake|northwind-fake|u_fake/)
  })

  test("names the grant: write scopes, read-only scopes, or a personal API key", () => {
    const grant = (value: unknown) => accountOf({ output: { tenant: { name: "Globex Ventures" }, grant: value } })?.grant
    expect(grant({ type: "access-token", scopes: ["mcp", "mcp.read", "offline_access"] })).toBe("read-write")
    expect(grant({ type: "access-token", scopes: ["mcp.read", "offline_access"] })).toBe("read-only")
    expect(grant({ type: "access-token", scopes: ["api.read"] })).toBe("read-only")
    expect(grant({ type: "api-key", scopes: ["api"] })).toBe("api-key")
    expect(grant({ type: "access-token", scopes: ["something-else"] })).toBeUndefined()
    expect(grant({ type: "access-token" })).toBeUndefined()
  })

  test("cuts a long name, strips control characters, and ignores results without the fields", () => {
    expect(accountOf({ output: { tenant: { name: "x".repeat(200) } } })?.organisation).toHaveLength(80)
    for (const result of [{}, { output: "not json" }, { output: [1] }, { content: [{ type: "image" }] }, { output: { tenant: { name: 3 } } }, { output: { user: { firstName: "Jane" } } }]) {
      expect(accountOf(result)).toBeUndefined()
    }
  })
})

describe("watchAccount", () => {
  test("captures a completed model call of get_current_user only", async () => {
    const { account, after } = await watch()
    await after({ tool: "affinity_search_persons", status: "completed", result: { output: RESULT } })
    await after({ tool: "affinity_get_current_user", status: "error", error: new Error("x") })
    expect(account.current()).toBeUndefined()
    await after({ tool: "affinity_get_current_user", status: "completed", result: { output: RESULT } })
    expect(account.current()).toEqual({ organisation: "Northwind Capital", grant: "read-write" })
    // A later result without the fields keeps what was read.
    await after({ tool: "affinity_get_current_user", status: "completed", result: { output: "{}" } })
    expect(account.current()?.organisation).toBe("Northwind Capital")
  })

  test("a script's read through the tools RPC reaches every running instance", async () => {
    const first = await watch()
    const second = await watch()
    captureAccount({ output: RESULT })
    expect([first.account.current()?.grant, second.account.current()?.grant]).toEqual(["read-write", "read-write"])
  })

  test("forgets the account when the server needs a new sign-in or the account is switched", async () => {
    const { account, after, state, stream } = await watch()
    await after({ tool: "affinity_get_current_user", status: "completed", result: { output: RESULT } })
    await tick()
    stream.emit("mcp.status.changed", { server: "other" })
    await tick()
    expect(account.current()).toBeDefined()
    state.server = "needs_auth"
    stream.emit("mcp.status.changed", { server: "affinity" })
    await tick()
    expect(account.current()).toBeUndefined()
    state.server = "connected"
    await after({ tool: "affinity_get_current_user", status: "completed", result: { output: RESULT } })
    expect(account.current()).toBeDefined()
    stream.emit("credential.switched")
    await tick()
    expect(account.current()).toBeUndefined()
  })

  test("while any instance signs in with its own key entry, a script's account read updates no status", async () => {
    const shared = await watch()
    const stream = events()
    const own = await watchAccount(
      { tool: { hook: async () => ({ dispose: async () => {} }) }, mcp: { list: async () => ({ data: [] }) }, event: { subscribe: stream.subscribe } } as never,
      () => true,
    )
    stops.push(own.stop)
    captureAccount({ output: RESULT })
    expect([shared.account.current(), own.current()]).toEqual([undefined, undefined])
    // The model path belongs to its own instance, so it still records the account there.
    await shared.after({ tool: "affinity_get_current_user", status: "completed", result: { output: RESULT } })
    expect(shared.account.current()?.organisation).toBe("Northwind Capital")
  })

  test("an instance whose affinity server is at another URL records no account, from the model or a script", async () => {
    const stream = events()
    let after: ((event: unknown) => Promise<void> | void) | undefined
    const foreign = await watchAccount(
      {
        tool: { hook: async (_name: string, callback: (event: unknown) => void) => ((after = callback), { dispose: async () => {} }) },
        mcp: { list: async () => ({ data: [{ name: "affinity", status: { status: "connected" } }] }) },
        event: { subscribe: stream.subscribe },
      } as never,
      () => false,
      () => false,
    )
    stops.push(foreign.stop)
    await after?.({ tool: "affinity_get_current_user", status: "completed", result: { output: RESULT } })
    captureAccount({ output: RESULT })
    expect(foreign.current()).toBeUndefined()
  })

  test("remembers that the server connected since OpenCode started, so status tells a renewal from a first sign-in", async () => {
    const { account, stream } = await watch()
    expect(account.everConnected()).toBe(false)
    stream.emit("mcp.status.changed", { server: "affinity" })
    await tick()
    expect(account.everConnected()).toBe(true)
  })

  test("notes when the server's status last changed, for status's listing check", async () => {
    const { account, stream } = await watch()
    const started = account.changedAt()
    await tick()
    stream.emit("mcp.status.changed", { server: "other" })
    await tick()
    expect(account.changedAt()).toBe(started)
    stream.emit("mcp.status.changed", { server: "affinity" })
    await tick()
    expect(account.changedAt()).toBeGreaterThan(started)
  })

  test("stops capturing once stopped", async () => {
    const { account } = await watch()
    await stops.pop()!()
    captureAccount({ output: RESULT })
    expect(account.current()).toBeUndefined()
  })
})
