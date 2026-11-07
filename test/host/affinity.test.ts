// The plugin on the public @opencode/sdk host: H1 load and connect, H2 what runs and what asks, H3 the permission
// model (P1-P5), H4 adoption and conflict, H5 /affinity-status and the account capture, H6 unload, the user's own
// server with an API key that never reaches status, the account read by model turns with Code Mode off and on, the ten
// denied tools on every path and the clean-up agent that opts in, a server that asks for a sign-in, a sign-in Affinity
// refuses, and the /connect entry. Each describe owns one host.
import { ROOT } from "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
import { CLIENT_URL, OAUTH_SCOPE, SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { DENIED_TOOLS } from "../../src/affinity-tools.js"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { ADMIN_STEP, SIGN_IN, StatusRpc } from "../../src/status.js"
import { TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { ADVERTISED_SCOPE, MODEL_ID } from "./fake-mcp.js"
import { agentRules, attempt, cleanup, effect, HOST_VERSION, session, startHost, until, type Host } from "./harness.js"

const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")
const AGENTS_NEXT_STEP = "Put the default rules shown by /affinity-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Affinity tools."
const KEY = "sk-fake-host-test-0123456789"
/** The denied tools as the Tools row names them, in the order the host lists tools. */
const SORTED_OFF = [...DENIED_TOOLS].sort()
const OFF = `${SORTED_OFF.slice(0, -1).join(", ")} and ${SORTED_OFF.at(-1)}`

// Starting a host takes several seconds, more on a busy machine.
setDefaultTimeout(120_000)
afterAll(cleanup)

const BUILT_IN = ["build", "general", "explore", "compaction", "title", "summary", "plan"]
const allow = (tool: string): Rule => ({ action: `affinity_${tool}`, resource: "*", effect: "allow" })
const deny = (tool: string): Rule => ({ action: `affinity_${tool}`, resource: "*", effect: "deny" })
const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
/** The host hides a tool when the last rule matching its action is a deny on every resource. */
const hidden = (rules: readonly Rule[], action: string) => {
  const last = rules.findLast((rule) => wildcard(rule.action).test(action))
  return last?.resource === "*" && last.effect === "deny"
}

/**
 * The host lists an MCP server's tools shortly after it connects. The registry lists the ten denied tools too; the
 * deny hides them from the model's tools and refuses them.
 */
const affinityTools = (host: Host) =>
  until("Affinity's tools are registered", async () => {
    const ids = (await host.probe().tool.list()).map((tool) => tool.id).filter((id) => id.startsWith("affinity_"))
    return ids.length === 3 + DENIED_TOOLS.length + 1 && ids.sort()
  })

async function status(host: Host, sessionID: string) {
  await host.client.sessions.command({ sessionID, name: "affinity-status", text: "" })
  return until("/affinity-status posts its text", async () => {
    const inbox = await host.client.session.inbox.list({ sessionID })
    const posted = inbox.findLast((item) => item.type === "synthetic")
    return posted?.type === "synthetic" ? posted.payload.text : undefined
  })
}

/** Enough of the tools RPC's contract for the client to call describe and the methods these tests use. */
const TOOLS_CONTRACT = {
  id: TOOLS_RPC_ID,
  methods: Object.fromEntries(["describe", "get_current_user", "search_persons", "create_note", ...DENIED_TOOLS].map((name) => [name, { input: { type: "object" }, output: { type: "object" } }])),
  events: {},
}
type ToolsClient = Record<string, (input: object, options: object) => Promise<unknown>>
const toolsRpc = (host: Host) => (host.client.rpc as unknown as (definition: object) => ToolsClient)(TOOLS_CONTRACT)
/** A session whose own rules are the grant a script needs: a blanket deny, then one allow per method it may call. */
const grantedSession = async (host: Host, permissions: Rule[]) =>
  (await host.client.sessions.create({ agent: "build", permissions, location: host.location })).id

/** A tools RPC call's output, or its error as JSON, so a test can search either for a secret. */
const scriptCall = (host: Host, method: string, input: object) =>
  toolsRpc(host)[method]!(input, { location: host.location }).then(
    (output) => JSON.stringify(output),
    (error: unknown) => JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})),
  )

const statusRpc = (host: Host) => (host.client.rpc as unknown as (definition: typeof StatusRpc) => { status: (input: object, options: object) => Promise<Record<string, unknown>> })(StatusRpc).status({}, { location: host.location })

describe(`the plugin on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ agents: { reviewer: { description: "Reviews changes", mode: "subagent" } } }) })
  })
  afterAll(() => host?.close())

  test("the host's global folders, temp folder and working directory are inside the test's temp root", async () => {
    const global = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"].map((key) => join(process.env[key]!, "opencode"))
    expect(global.filter((path) => !existsSync(path))).toEqual([])
    const { paths } = await host.client.server.info()
    const used = [...global, realpathSync(paths.tmp), process.env.OPENCODE_TEST_HOME!, tmpdir(), process.cwd()]
    expect(used.filter((path) => !path.startsWith(ROOT + sep))).toEqual([])
  })

  test("H1: the plugin is active, affinity is connected, and its tools, skills and command are registered", async () => {
    const { data: plugins } = await host.client.plugin.list({ location: host.location })
    expect(plugins.find((plugin) => plugin.id === "affinity.crm")?.state.status).toBe("active")
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    expect(servers.find((server) => server.name === "affinity")?.status).toEqual({ status: "connected" })
    expect(await affinityTools(host)).toEqual([...["create_note", "get_current_user", "search_persons", "shiny_new_tool", ...DENIED_TOOLS].map((tool) => `affinity_${tool}`)].sort())
    const { data: skills } = await host.client.skill.list({ location: host.location })
    expect(skills.map((skill) => skill.id).filter((id) => id.startsWith("affinity")).sort()).toEqual([...SKILL_NAMES].sort())
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).toContain("affinity-status")
  })

  test("P1: the rules sit right after the base allow in every built-in agent, once", async () => {
    const rules = await agentRules(host)
    for (const id of BUILT_IN) {
      const permissions = rules.get(id)!
      const base = permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      expect(base).toBe(0)
      expect(permissions.slice(base + 1, base + 1 + defaultRules().length)).toEqual(defaultRules())
      expect(permissions.filter((rule) => rule.action === "affinity_*")).toHaveLength(1)
    }
  })

  test("P1: Plan and Explore are not weakened", async () => {
    expect(await effect(host, "plan", "edit")).toBe("deny")
    expect(await effect(host, "explore", "affinity_search_persons")).toBe("deny")
    const explore = await session(host, "explore")
    expect(await attempt(host, explore, "explore", "search_persons")).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: affinity_search_persons" })
    const plan = await session(host, "plan")
    expect(await attempt(host, plan, "plan", "shiny_new_tool")).toMatchObject({ asked: "affinity_shiny_new_tool", ok: false })
  })

  test("P2 and H2: known reads run without a prompt, everything else asks, and the ten denied tools are hidden", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", "search_persons")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool")).toEqual({ asked: "affinity_shiny_new_tool", ok: false, error: "Permission.DeclinedError: " })
    expect(await attempt(host, build, "build", "create_note")).toEqual({ asked: "affinity_create_note", ok: false, error: "Permission.DeclinedError: " })
    expect(host.fake.calls.slice(before)).toEqual(["search_persons"])
    const rules = (await agentRules(host)).get("build")!
    expect(["affinity_search_persons", "affinity_create_note", "affinity_shiny_new_tool"].filter((action) => hidden(rules, action))).toEqual([])
    // DC-5: each denied tool is hidden, refused with no prompt, and never reaches Affinity, in every built-in agent.
    const all = await agentRules(host)
    for (const tool of DENIED_TOOLS) {
      for (const id of BUILT_IN) expect({ id, tool, hidden: hidden(all.get(id)!, `affinity_${tool}`) }).toEqual({ id, tool, hidden: true })
      expect(await effect(host, "build", `affinity_${tool}`)).toBe("deny")
      expect(await attempt(host, build, "build", tool, "always")).toEqual({ asked: undefined, ok: false, error: `Tool.Error: Permission denied: affinity_${tool}` })
      expect(host.fake.calls).not.toContain(tool)
    }
  })

  test("a script's read runs, and a write runs only in a session that names an allow for it", async () => {
    const reader = await session(host)
    const before = host.fake.calls.length
    const read = JSON.parse(await scriptCall(host, "search_persons", { sessionID: reader, input: { term: "Acme" } })) as { text: string }
    expect(read.text).toBe("called search_persons")
    expect(host.fake.calls.slice(before)).toEqual(["search_persons"])
    const writer = await grantedSession(host, [{ action: "*", resource: "*", effect: "deny" }, { action: "affinity_create_note", resource: "*", effect: "allow" }])
    const write = JSON.parse(await scriptCall(host, "create_note", { sessionID: writer, input: { content: "Example note" } })) as { text: string }
    expect(write.text).toBe("called create_note")
    expect(host.fake.calls.at(-1)).toBe("create_note")
  })

  test("a write that would ask is refused before dispatch, with no Affinity call", async () => {
    const before = host.fake.calls.length
    const refused = JSON.parse(await scriptCall(host, "create_note", { sessionID: await session(host), input: { content: "Example note" } })) as { message: string }
    expect(refused.message).toContain("PERMISSION_DENIED: affinity_create_note would ask")
    expect(host.fake.calls.length).toBe(before)
  })

  test("describe with a session reports each method's class and permission, and without one no permission", async () => {
    const described = JSON.parse(await scriptCall(host, "describe", { sessionID: await session(host) })) as {
      location: string
      locationHint: string
      methods: { name: string; class: string; permission?: string }[]
    }
    const find = (name: string) => described.methods.find((method) => method.name === name)!
    expect(find("search_persons")).toMatchObject({ class: "read", permission: "allow" })
    expect(find("warm_intro")).toMatchObject({ class: "send", permission: "allow" })
    expect(find("create_note")).toMatchObject({ class: "write", permission: "ask" })
    expect(find("delete_person")).toMatchObject({ class: "destructive", permission: "deny" })
    expect(described.location).toBe(host.location.directory)
    expect(described.locationHint).toContain("x-opencode-directory")
    const plain = JSON.parse(await scriptCall(host, "describe", {})) as { methods: { permission?: string }[] }
    expect(plain.methods.every((method) => !Object.hasOwn(method, "permission"))).toBe(true)
  })

  test("the location: describe reports where the call landed, and a call that names another location is answered there", async () => {
    const elsewhere = join(ROOT, "elsewhere")
    mkdirSync(elsewhere, { recursive: true })
    const rpc = (host.client.rpc as unknown as (definition: object) => ToolsClient)(TOOLS_CONTRACT)
    const there = (await rpc.describe!({}, { location: { directory: elsewhere } })) as { location: string }
    expect(there.location).toBe(elsewhere)
    // Without a location the call reaches the service's default location, which is why a script sends the header.
    const fallback = (await rpc.describe!({}, {})) as { location: string }
    expect(fallback.location).not.toBe(host.location.directory)
  })

  test("DC-5: no script reaches a denied tool: each is a method, describe shows it denied, and a call is refused before dispatch", async () => {
    const sessionID = await session(host)
    const described = JSON.parse(await scriptCall(host, "describe", { sessionID })) as { methods: { name: string; class: string; permission: string }[] }
    for (const tool of DENIED_TOOLS) {
      expect(described.methods.find((method) => method.name === tool)).toMatchObject({ class: "destructive", permission: "deny" })
      const before = host.fake.calls.length
      const call = (host.client.rpc as unknown as { call: (input: object) => Promise<unknown> }).call
      const outcome = await call({ rpcID: TOOLS_RPC_ID, method: tool, input: { sessionID, input: { confirm: true } }, location: host.location }).then(
        (output) => ({ ran: true, output }),
        (error: unknown) => ({ ran: false, error: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})) }),
      )
      expect(outcome).toMatchObject({ ran: false })
      expect(JSON.stringify(outcome)).toContain("PERMISSION_DENIED")
      expect(host.fake.calls.length).toBe(before)
      expect(host.fake.calls).not.toContain(tool)
    }
  })

  test("P4: a saved 'Always allow' removes the prompt", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "shiny_new_tool", "always")).toMatchObject({ asked: "affinity_shiny_new_tool", ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
    const { projectID } = await host.client.sessions.get({ sessionID: build })
    const saved = await host.client.permission.saved.list({ projectID })
    expect(saved.map(({ action, resource }) => ({ action, resource }))).toEqual([{ action: "affinity_shiny_new_tool", resource: "*" }])
  })

  test("P5: an agent defined only in user config gets no rules, and Affinity tools run there unprompted", async () => {
    const reviewer = (await agentRules(host)).get("reviewer")!
    expect(reviewer.some((rule) => rule.action.startsWith("affinity_"))).toBe(false)
    const sessionID = await session(host, "reviewer")
    expect(await attempt(host, sessionID, "reviewer", "create_note")).toMatchObject({ asked: undefined, ok: true })
  })

  test("H5: /affinity-status reports the connection, new tools, the unguarded agent and its fix, before any account read", async () => {
    await affinityTools(host)
    // DR-4: status, its RPC and the dialog's refresh make no Affinity call of their own: a firm's shared quota must not
    // be spent by opening or refreshing the dialog.
    const calls = host.fake.calls.length
    const text = await status(host, await session(host))
    await statusRpc(host)
    await statusRpc(host)
    expect(host.fake.calls.length).toBe(calls)
    expect(text).toContain(`- Connection: connected (${host.fake.url}, registered by this plugin)`)
    expect(text).toContain("- Account: not read yet")
    expect(text).toContain(`- Tools: 4 available, 1 unknown: shiny_new_tool (unknown tools ask before running); off by default: ${OFF}\n`)
    expect(text).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n`)
    expect(text).toContain(`- Next step: ${AGENTS_NEXT_STEP}`)
    expect(text).toContain(`- OpenCode: ${HOST_VERSION} (${TESTED_HOSTS.includes(HOST_VERSION) ? "tested" : "untested"}; supported range ${SUPPORTED_HOST})`)
  })

  test("H5: an account read fills the organisation and the grant, in /affinity-status and the dialog's RPC", async () => {
    // The host's executors skip execute.after hooks, so this read goes through the tools RPC, which records the
    // account with the same function; a model turn records it through the hook.
    await toolsRpc(host).get_current_user!({ sessionID: await session(host), input: {} }, { location: host.location })
    const text = await status(host, await session(host))
    expect(text).toContain("- Account: Northwind Capital\n")
    expect(text).toContain("- Access: Affinity grant: read-only, so Affinity refuses changes;")
    expect(text).toContain("- Organisation setup: done: this Affinity organisation lets OpenCode sign in\n")
    expect(await statusRpc(host)).toMatchObject({ organisation: "Northwind Capital", grant: "read-only", adminStep: null, unguardedAgents: ["reviewer"] })
    // Only the organisation's name and the grant: no user, email or ids from the result.
    expect(JSON.stringify(await statusRpc(host))).not.toMatch(/u_fake_1|tenant_fake_1|northwind-fake|Jane|jane\.doe/)
    expect(text).not.toMatch(/u_fake_1|tenant_fake_1|northwind-fake|Jane|jane\.doe/)
  })

  test("H6: unloading the plugin removes the server, the rules and the command", async () => {
    // Registering a plugin with the same ID replaces the old generation, which disposes everything it registered.
    await host.client.plugin(Plugin.define({ id: "affinity.crm", setup: () => {} }))
    await until("the affinity server is gone", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return !data.some((server) => server.name === "affinity")
    })
    const rules = await agentRules(host)
    for (const id of BUILT_IN) expect(rules.get(id)!.some((rule) => rule.action.startsWith("affinity_"))).toBe(false)
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).not.toContain("affinity-status")
  })
})

describe("the user's own affinity server, signing in with an API key", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({ mcp: { servers: { affinity: { type: "remote", url, oauth: false, headers: { "x-affinity-test": "user", Authorization: `Bearer ${KEY}` } } } } }),
    })
  })
  afterAll(() => host?.close())

  test("H4: is adopted unchanged: the host sends its headers, and the plugin's rules still apply", async () => {
    expect(await attempt(host, await session(host), "build", "search_persons")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, await session(host), "build", "create_note")).toMatchObject({ asked: "affinity_create_note", ok: false })
    expect(host.fake.markers.length).toBeGreaterThan(0)
    expect(new Set(host.fake.markers)).toEqual(new Set(["user"]))
    expect(new Set(host.fake.authorizations)).toEqual(new Set([`Bearer ${KEY}`]))
  })

  test("the key never reaches /affinity-status or the status RPC, which name the entry as the user's own", async () => {
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.url}, your own mcp.servers.affinity without OAuth, used unchanged)`)
    const output = await statusRpc(host)
    expect(output).toMatchObject({ state: "connected", source: { type: "adopted", signIn: "own" } })
    for (const shown of [text, JSON.stringify(output)]) {
      expect(shown).not.toContain(KEY)
      expect(shown).not.toMatch(/Bearer|Authorization/i)
    }
  })

  test("the key never reaches a script: not describe, a result or an upstream error", async () => {
    const sessionID = await session(host)
    const describe = await scriptCall(host, "describe", {})
    expect(describe).toContain("search_persons")
    const result = await scriptCall(host, "search_persons", { sessionID, input: { term: "Acme" } })
    expect(result).toContain("called search_persons")
    const failure = await scriptCall(host, "search_persons", { sessionID, input: { query: "fail" } })
    expect(failure).toContain("UPSTREAM_ERROR")
    for (const shown of [describe, result, failure]) {
      expect(shown).not.toContain(KEY)
      expect(shown).not.toMatch(/Bearer/i)
    }
  })
})

describe("a model turn that reads the account", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({
        // The user's own entry at the fake, with Code Mode off, so the tools are the model's own tools.
        mcp: { servers: { affinity: { type: "remote", url, oauth: false, codemode: false } } },
        // No model leaves the machine: LM Studio's local API is the fake; the other local providers are off.
        providers: { lmstudio: { settings: { baseURL: `${new URL(url).origin}/v1` } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
      }),
    })
    const models = host.client as unknown as { model: { list: (input: object) => Promise<{ data: { id: string; providerID: string }[] }> } }
    await until("the scripted model is listed", async () => (await models.model.list({ location: host.location })).data.find((model) => model.providerID === "lmstudio" && model.id === MODEL_ID))
    await affinityTools(host)
  })
  afterAll(() => host?.close())

  test("the model's own get_current_user call fills the organisation and the grant through the execute.after hook", async () => {
    host.fake.model.script = [{ tool: "affinity_get_current_user", arguments: {} }]
    const sessions = host.client.sessions as unknown as {
      create: (input: object) => Promise<{ id: string }>
      prompt: (input: object) => Promise<unknown>
    }
    const sessionID = (await sessions.create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    expect(await status(host, await session(host))).toContain("- Account: not read yet")
    await sessions.prompt({ sessionID, text: "Which Affinity organisation am I in?" })
    await until("the model's final turn", async () => host.fake.model.requests.filter((request) => (request as { messages?: { role: string }[] }).messages?.some((message) => message.role === "tool")).length > 0)
    expect(host.fake.calls).toContain("get_current_user")
    const text = await until("status shows the account", async () => {
      const posted = await status(host, await session(host))
      return posted.includes("Northwind Capital") ? posted : undefined
    })
    expect(text).toContain("- Account: Northwind Capital\n")
    expect(text).toContain("- Access: Affinity grant: read-only, so Affinity refuses changes;")
    expect(text).not.toMatch(/u_fake_1|tenant_fake_1|Jane/)
  })

  test("DC-5: the model's own calls to the ten denied tools never reach Affinity, and none is offered to it", async () => {
    host.fake.model.script = DENIED_TOOLS.map((tool) => ({ tool: `affinity_${tool}`, arguments: { confirm: true } }))
    const before = host.fake.model.requests.length
    const sessions = host.client.sessions as unknown as {
      create: (input: object) => Promise<{ id: string }>
      prompt: (input: object) => Promise<unknown>
    }
    const sessionID = (await sessions.create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await sessions.prompt({ sessionID, text: "Delete the duplicate companies, merge the two Jane Doe records, and tell Affinity about it." })
    const turns = () => host.fake.model.requests.slice(before) as { tools?: { function?: { name?: string } }[]; messages?: { role: string }[] }[]
    await until("the model's final turn", async () => turns().some((request) => (request.messages ?? []).filter((message) => message.role === "tool").length >= DENIED_TOOLS.length))
    const offered = turns().flatMap((request) => (request.tools ?? []).map((item) => item.function?.name ?? ""))
    expect(offered.filter((name) => name.startsWith("affinity_"))).toContain("affinity_get_current_user")
    for (const tool of DENIED_TOOLS) {
      expect(offered).not.toContain(`affinity_${tool}`)
      expect(host.fake.calls).not.toContain(tool)
    }
  })
})

describe("a Code Mode turn that reads the account", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({
        // Code Mode on, as users run it by default: the model calls Affinity inside Code Mode's execute tool.
        mcp: { servers: { affinity: { type: "remote", url, oauth: false } } },
        providers: { lmstudio: { settings: { baseURL: `${new URL(url).origin}/v1` } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
      }),
    })
    const models = host.client as unknown as { model: { list: (input: object) => Promise<{ data: { id: string; providerID: string }[] }> } }
    await until("the scripted model is listed", async () => (await models.model.list({ location: host.location })).data.find((model) => model.providerID === "lmstudio" && model.id === MODEL_ID))
    await affinityTools(host)
  })
  afterAll(() => host?.close())

  test("DC-10: an inner tools.affinity.get_current_user call fills the account through the execute.after hook", async () => {
    host.fake.model.script = [{ tool: "execute", arguments: { code: "return await tools.affinity.get_current_user({})" } }]
    const sessions = host.client.sessions as unknown as {
      create: (input: object) => Promise<{ id: string }>
      prompt: (input: object) => Promise<unknown>
    }
    const sessionID = (await sessions.create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await sessions.prompt({ sessionID, text: "Which Affinity organisation am I in?" })
    await until("the model's final turn", async () => host.fake.model.requests.some((request) => (request as { messages?: { role: string }[] }).messages?.some((message) => message.role === "tool")))
    expect(host.fake.calls).toContain("get_current_user")
    const text = await until("status shows the account", async () => {
      const posted = await status(host, await session(host))
      return posted.includes("Northwind Capital") ? posted : undefined
    })
    expect(text).toContain("- Account: Northwind Capital\n")
    expect(text).not.toMatch(/u_fake_1|tenant_fake_1|Jane/)
  })

  test("AF-5: inside execute, each denied tool is missing from the namespace call and never reaches Affinity", async () => {
    // The riskiest path users run by default: the model calls Affinity inside Code Mode. The deny is on each tool's
    // own action, so Code Mode's namespace has no such function; a catch keeps the script running to report it.
    const attempts = DENIED_TOOLS.map((tool) => `try { await tools.affinity.${tool}({ confirm: true }); out.push("ran ${tool}") } catch (error) { out.push("${tool}:" + String(error).slice(0, 80)) }`).join(" ")
    host.fake.model.script = [{ tool: "execute", arguments: { code: `const out = []; ${attempts}; return out` } }]
    const before = host.fake.calls.length
    const requests = host.fake.model.requests.length
    const sessions = host.client.sessions as unknown as {
      create: (input: object) => Promise<{ id: string }>
      prompt: (input: object) => Promise<unknown>
    }
    const sessionID = (await sessions.create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await sessions.prompt({ sessionID, text: "Delete the duplicate company, merge the two person records and report it to Affinity." })
    await until("the Code Mode turn ends", async () => host.fake.model.requests.length > requests && (host.fake.model.requests.at(-1) as { messages?: { role: string }[] }).messages?.some((message) => message.role === "tool"))
    expect(host.fake.calls.slice(before)).toEqual([])
    for (const tool of DENIED_TOOLS) expect(host.fake.calls).not.toContain(tool)
  })
})

describe("the documented clean-up agent for deletes and merges", () => {
  // docs/configuration.md's recipe: an agent defined only in config, whose own permissions hold the plugin's block, then
  // an ask for each delete and merge. send_feedback stays off there.
  const asks: Rule[] = DENIED_TOOLS.filter((tool) => tool !== "send_feedback").map((tool) => ({ action: `affinity_${tool}`, resource: "*", effect: "ask" }))
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: () => ({ agents: { "crm-cleanup": { description: "Affinity clean-up: deletes and merges, each asked first", mode: "primary", permissions: [...defaultRules(), ...asks] } } }),
    })
  })
  afterAll(() => host?.close())

  test("DC-5: turns each delete and merge into a per-call ask in that agent only, never an allow, and keeps send_feedback off", async () => {
    await affinityTools(host)
    for (const rule of asks) expect(await effect(host, "crm-cleanup", rule.action)).toBe("ask")
    expect(await effect(host, "crm-cleanup", "affinity_send_feedback")).toBe("deny")
    const cleanup = await session(host, "crm-cleanup")
    expect(await attempt(host, cleanup, "crm-cleanup", "merge_persons")).toEqual({ asked: "affinity_merge_persons", ok: false, error: "Permission.DeclinedError: " })
    expect(host.fake.calls).not.toContain("merge_persons")
    // Each call asks again: a "once" answer runs one call and saves nothing.
    expect(await attempt(host, cleanup, "crm-cleanup", "merge_persons", "once")).toMatchObject({ asked: "affinity_merge_persons", ok: true })
    expect(await attempt(host, cleanup, "crm-cleanup", "merge_persons")).toMatchObject({ asked: "affinity_merge_persons", ok: false })
    expect(await attempt(host, cleanup, "crm-cleanup", "send_feedback", "always")).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: affinity_send_feedback" })
    // Every built-in agent, Explore included, keeps all ten off; the clean-up agent is not listed as unguarded.
    for (const id of BUILT_IN) for (const tool of DENIED_TOOLS) expect({ id, tool, effect: await effect(host, id, `affinity_${tool}`) }).toEqual({ id, tool, effect: "deny" })
    expect((await statusRpc(host)).unguardedAgents).toEqual([])
  })

  test("DC-5: a script can't reach a delete or merge even in that agent: its ask is refused before dispatch", async () => {
    const sessionID = await session(host, "crm-cleanup")
    const call = (host.client.rpc as unknown as { call: (input: object) => Promise<unknown> }).call
    const before = host.fake.calls.length
    for (const tool of DENIED_TOOLS) {
      const outcome = (await call({ rpcID: TOOLS_RPC_ID, method: tool, input: { sessionID, input: { confirm: true } }, location: host.location }).then(
        () => ({ ran: true, message: "" }),
        (error: unknown) => ({ ran: false, message: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})) }),
      )) as { ran: boolean; message: string }
      expect({ tool, ran: outcome.ran }).toEqual({ tool, ran: false })
      expect(outcome.message).toContain("PERMISSION_DENIED")
    }
    expect(host.fake.calls.slice(before)).toEqual([])
  })
})

describe("user permissions", () => {
  const userRules = [allow("create_note"), deny("search_persons")]
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: () => ({
        permissions: userRules,
        // The documented fix for a config-only agent: the plugin's block first, then the user's rules again.
        agents: { reviewer: { description: "Reviews changes", mode: "subagent", permissions: [...defaultRules(), ...userRules] } },
      }),
    })
  })
  afterAll(() => host?.close())

  test("P3: a user allow on a write removes the prompt, and a user deny on a read hides it", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "create_note")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "search_persons")).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: affinity_search_persons" })
    expect(hidden((await agentRules(host)).get("build")!, "affinity_search_persons")).toBe(true)
    expect(await attempt(host, build, "build", "shiny_new_tool")).toMatchObject({ asked: "affinity_shiny_new_tool", ok: false })
  })

  test("P5: the per-agent fix guards a config-only agent and keeps the user's rules winning", async () => {
    const reviewer = await session(host, "reviewer")
    expect(await attempt(host, reviewer, "reviewer", "shiny_new_tool")).toMatchObject({ asked: "affinity_shiny_new_tool", ok: false })
    expect(await attempt(host, reviewer, "reviewer", "create_note")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, reviewer, "reviewer", "search_persons")).toMatchObject({ asked: undefined, ok: false })
    expect(await status(host, reviewer)).toContain("- Agents without default rules: none\n")
  })
})

describe("a user affinity server that points elsewhere", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: (url) => ({ mcp: { servers: { affinity: { type: "remote", url: url.replace(/\/mcp$/, "/other"), oauth: false } } } }) })
  })
  afterAll(() => host?.close())

  test("H4: is left in place and reported as a conflict", async () => {
    const text = await status(host, await session(host))
    const other = host.fake.url.replace(/\/mcp$/, "/other")
    expect(text).toContain(`- Connection: conflict (your mcp.servers.affinity points at ${other})`)
    expect(text).toContain(`- Next step: Your OpenCode config defines mcp.servers.affinity with ${other}, but the plugin uses ${host.fake.url}.`)
  })
})

// Affinity's server answers 401 with a bearer challenge until the user signs in, or after its tokens are revoked. On
// the host's own MCP client that is a sign-in, not a failure: status says so, with the /connect step, and forgets the
// account read before it.
describe("a server that asks for a sign-in", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true })
  })
  afterAll(() => host?.close())

  test("DC-6: is sign-in required, with the /connect next step, in the RPC and in /affinity-status, and the account is forgotten", async () => {
    await affinityTools(host)
    await toolsRpc(host).get_current_user!({ sessionID: await session(host), input: {} }, { location: host.location })
    expect(await statusRpc(host)).toMatchObject({ state: "connected", organisation: "Northwind Capital" })
    // The tokens stop working: the next connection gets the challenge.
    host.fake.challenge = true
    const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
    await mcp.disconnect({ server: "affinity", location: host.location })
    await mcp.connect({ server: "affinity", location: host.location }).catch(() => {})
    const server = await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      const found = data.find((item) => item.name === "affinity")
      return found?.status.status === "needs_auth" ? found : undefined
    })
    expect(server.status.status).toBe("needs_auth")
    const output = await until("status forgets the account", async () => {
      const read = await statusRpc(host)
      return read.organisation === null ? read : undefined
    })
    // AF-2: this server connected earlier, so a sign-in that expired is a renewal: no admin step for a first sign-in.
    expect(output).toMatchObject({ state: "sign_in_required", nextStep: SIGN_IN, adminStep: null, everConnected: true, organisation: null, grant: null })
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: sign-in required (${host.fake.url}, registered by this plugin)`)
    expect(text).toContain("- Organisation setup: done earlier: the sign-in has expired, so run /connect again\n")
    expect(text).not.toContain("OpenCode's client URL")
    expect(text).toContain(`- Next step: ${SIGN_IN}`)
    expect(text).not.toContain("Northwind Capital")
  })
})

// AF-6: the two entries docs/configuration.md documents as a user's own `mcp.servers.affinity`. The plugin adopts each
// unchanged; the authorize endpoint shows what OpenCode asks with.
describe("the documented own entries", () => {
  const oauth = (host: Host) =>
    host.client.integration.oauth as unknown as {
      connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }>
      cancel: (input: object) => Promise<void>
    }
  /** Starts a sign-in as /connect does, and returns its authorize URL and the attempt to cancel. */
  async function authorizeUrl(host: Host) {
    const server = await until("the adopted server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      const found = data.find((item) => item.name === "affinity")
      return found?.status.status === "needs_auth" && found.integrationID ? found : undefined
    })
    const integrationID = server.integrationID!
    const { data: integration } = await host.client.integration.get({ integrationID, location: host.location })
    const { data: attempt } = await oauth(host).connect({ integrationID, methodID: (integration.methods[0] as unknown as { id: string }).id, location: host.location })
    return { integrationID, attempt, url: new URL(attempt.url) }
  }

  describe("the read-only entry", () => {
    let host: Host
    beforeAll(async () => {
      host = await startHost({ challenge: true, config: (url) => ({ mcp: { servers: { affinity: { type: "remote", url, oauth: { scope: "mcp.read offline_access" } } } } }) })
    })
    afterAll(() => host?.close())

    test("asks for the read scope alone, through OpenCode's client URL, and status names the entry as the user's own", async () => {
      const { integrationID, attempt, url } = await authorizeUrl(host)
      expect(url.searchParams.get("scope")).toBe("mcp.read offline_access")
      expect(url.searchParams.get("client_id")).toBe(CLIENT_URL)
      await oauth(host).cancel({ integrationID, attemptID: attempt.attemptID, location: host.location })
      expect(await statusRpc(host)).toMatchObject({ state: "sign_in_required", source: { type: "adopted", signIn: "oauth" }, adminStep: `${ADMIN_STEP} If your own mcp.servers.affinity entry uses your organisation's own OAuth app, ask for that app to be allowed instead.` })
    })
  })

  // AF-6 and DR-5: an own OAuth app has a real client ID, which this test does not have; the fake accepts any client, so
  // what is proven here is the request OpenCode builds: the entry's client ID instead of its client URL, and the loopback
  // redirect the guide tells the admin to register.
  describe("the organisation's own OAuth app", () => {
    const CLIENT_ID = "affinity-org-fake-client-0123456789"
    let host: Host
    beforeAll(async () => {
      host = await startHost({
        challenge: true,
        config: (url) => ({ mcp: { servers: { affinity: { type: "remote", url, oauth: { client_id: CLIENT_ID, scope: "mcp mcp.read offline_access" } } } } }),
      })
    })
    afterAll(() => host?.close())

    test("DR-5: OpenCode asks with the entry's client ID, CIMD off, and its loopback redirect; status names the entry as the user's own", async () => {
      const { integrationID, attempt, url } = await authorizeUrl(host)
      expect(url.searchParams.get("client_id")).toBe(CLIENT_ID)
      expect(url.searchParams.get("client_id")).not.toBe(CLIENT_URL)
      // Affinity matches a loopback redirect URI by ignoring the port, which is why the guide says to register
      // http://127.0.0.1/callback: OpenCode sends its own port.
      const redirect = new URL(url.searchParams.get("redirect_uri")!)
      expect({ protocol: redirect.protocol, hostname: redirect.hostname, pathname: redirect.pathname }).toEqual({ protocol: "http:", hostname: "127.0.0.1", pathname: "/callback" })
      expect(redirect.port).toMatch(/^\d+$/)
      expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPE)
      await oauth(host).cancel({ integrationID, attemptID: attempt.attemptID, location: host.location })
      const output = await statusRpc(host)
      expect(output).toMatchObject({ state: "sign_in_required", source: { type: "adopted", signIn: "oauth" } })
      const text = await status(host, await session(host))
      expect(text).toContain("- Connection: sign-in required (")
      expect(text).toContain("your own mcp.servers.affinity, used unchanged")
      // The client ID never reaches status.
      for (const shown of [text, JSON.stringify(output)]) expect(shown).not.toContain(CLIENT_ID)
    })
  })
})

describe("the /connect entry", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true })
  })
  afterAll(() => host?.close())

  const entry = async () => {
    const { data } = await host.client.mcp.list({ location: host.location })
    const integrationID = data.find((server) => server.name === "affinity")?.integrationID
    if (!integrationID) return undefined
    return (await host.client.integration.get({ integrationID, location: host.location })).data
  }

  test("DR-1: a sign-in started while the server is connected still asks for the pinned scope, where no challenge asks for one", async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((server) => server.name === "affinity")!.integrationID!
    const { data: integration } = await host.client.integration.get({ integrationID, location: host.location })
    const oauth = host.client.integration.oauth as unknown as {
      connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }>
      cancel: (input: object) => Promise<void>
    }
    const { data: attempt } = await oauth.connect({ integrationID, methodID: (integration.methods[0] as unknown as { id: string }).id, location: host.location })
    // The server answers, so there is no 401 and no challenge scope: without the pin the request would carry none.
    expect(host.fake.challenge).toBe(false)
    expect(new URL(attempt.url).searchParams.get("scope")).toBe(OAUTH_SCOPE)
    await oauth.cancel({ integrationID, attemptID: attempt.attemptID, location: host.location })
  })

  test("is named Affinity, also after the host reloads its MCP servers", async () => {
    expect((await until("the entry is named Affinity", async () => ((await entry())?.name === "Affinity" ? entry() : undefined)))?.methods).toHaveLength(1)
    await host.probe().mcp.reload()
    await until("the entry is named Affinity again after the reload", async () => (await entry())?.name === "Affinity")
    await Bun.sleep(1000)
    expect((await entry())?.name).toBe("Affinity")
  })
})

// AB-3: the /connect mark is only observable while a credential remains, so this signs in with Affinity's own flow and a
// token that has no refresh token: a 401 then needs a new sign-in rather than a refresh, and the account stays. The
// plugin reads its mark back from the projected connection, so the mark it sets is the one it clears.
describe("the /connect sign-in mark", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, challenge: true, fake: { refreshTokens: false } })
  })
  afterAll(() => host?.close())

  const SIGN_IN_AGAIN = "Affinity needs a new sign-in. Choose this account to sign in again."

  /** The /connect entry's connections, with the status a credential shows there. */
  const connections = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((item) => item.name === "affinity")?.integrationID
    if (!integrationID) return []
    const { data } = await host.client.integration.get({ integrationID, location: host.location })
    return (data as unknown as { connections?: { type?: string; status?: { status: string; message?: string } }[] }).connections ?? []
  }

  /** Signs in through OpenCode's own flow: the authorization endpoint redirects the loopback callback, which exchanges its code. */
  const signIn = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((item) => item.name === "affinity")!.integrationID!
    const { data: integration } = await host.client.integration.get({ integrationID, location: host.location })
    const oauth = (host.client.integration as unknown as { oauth: { connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }> } }).oauth
    const { data: attempt } = await oauth.connect({ integrationID, methodID: (integration.methods[0] as unknown as { id: string }).id, location: host.location })
    const redirect = await fetch(attempt.url, { redirect: "manual" })
    const callback = redirect.headers.get("location")
    expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    await fetch(callback!)
  }
  const connected = () =>
    until("the server is connected", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((item) => item.name === "affinity")?.status.status === "connected"
    })

  test("is set while the server needs a sign-in, and cleared once the same account connects again", async () => {
    host.fake.refuse = "sign-in"
    await signIn()
    await until("the sign-in stores a token without a refresh token", async () => host.fake.tokens.length === 1)
    expect(host.fake.tokens[0]).toMatchObject({ grant_type: "authorization_code" })
    expect(host.fake.tokens[0]).not.toHaveProperty("refresh_token")
    host.fake.challenge = false
    await connected()
    expect(await until("/connect shows the account", async () => (await connections()).find((item) => item.type === "credential" && item.status?.message === undefined))).toBeDefined()

    // The token stops working, and there is no refresh token: a new sign-in, with the credential kept.
    host.fake.challenge = true
    const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
    await mcp.disconnect({ server: "affinity", location: host.location })
    await mcp.connect({ server: "affinity", location: host.location }).catch(() => {})
    await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((item) => item.name === "affinity")?.status.status === "needs_auth"
    })
    expect(await until("/connect shows the new sign-in on the account", async () => (await connections()).find((item) => item.status?.message === SIGN_IN_AGAIN))).toBeDefined()

    // The same account connects again: the plugin clears its own mark.
    host.fake.challenge = false
    await mcp.connect({ server: "affinity", location: host.location })
    await connected()
    expect(await until("/connect clears the sign-in mark", async () => ((await connections()).some((item) => item.status?.message) ? undefined : true))).toBe(true)
  })
})

// Affinity accepts OpenCode's client metadata document only once an organisation admin has added it. Until then it
// refuses the client: with its own error page that never returns to OpenCode (what Affinity documents), or with a
// redirect that carries an `error`. OpenCode 2.2.x stores no credential either way, keeps the server `needs_auth`, and
// tells plugins nothing, so status can only give the admin step beside the sign-in step.
describe("a sign-in that Affinity refuses, because the organisation has not added OpenCode", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, challenge: true })
  })
  afterAll(() => host?.close())

  const oauth = () =>
    host.client.integration.oauth as unknown as {
      connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }>
      status: (input: object) => Promise<{ data: { status: string; message?: string } }>
      cancel: (input: object) => Promise<void>
    }

  /** Starts a sign-in as /connect does, and returns the attempt and the authorize URL OpenCode opens. */
  async function signIn() {
    const server = await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      const found = data.find((item) => item.name === "affinity")
      return found?.status.status === "needs_auth" && found.integrationID ? found : undefined
    })
    const integrationID = server.integrationID!
    const { data: integration } = await host.client.integration.get({ integrationID, location: host.location })
    const { data: attempt } = await oauth().connect({ integrationID, methodID: (integration.methods[0] as unknown as { id: string }).id, location: host.location })
    return { integrationID, attempt, url: new URL(attempt.url) }
  }
  const attemptStatus = async (integrationID: string, attemptID: string) => (await oauth().status({ integrationID, attemptID, location: host.location })).data

  async function stillSignInRequired() {
    const output = await statusRpc(host)
    expect(output).toMatchObject({ state: "sign_in_required", nextStep: SIGN_IN, adminStep: ADMIN_STEP, everConnected: false, organisation: null })
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: sign-in required (${host.fake.url}, registered by this plugin)`)
    expect(text).toContain(`- Organisation setup: ${ADMIN_STEP}\n`)
    expect(text).toContain(`- Next step: ${SIGN_IN}`)
    expect(text.match(/Next step/g)).toHaveLength(1)
    const { data } = await host.client.mcp.list({ location: host.location })
    expect(data.find((item) => item.name === "affinity")?.status.status).toBe("needs_auth")
  }

  test("DR-1: OpenCode asks with its client URL and exactly the pinned scope, not the wider one the challenge advertises", async () => {
    // The fake's 401 and metadata advertise more than the pin, so OpenCode's own fallback (`oauth?.scope ?? challenge.scope`)
    // would ask for this wider list, with `api` and `api.read` on the consent screen: only the pin keeps it off.
    expect(host.fake.challengeScope).toBe(ADVERTISED_SCOPE)
    expect(ADVERTISED_SCOPE.split(" ")).toEqual(expect.arrayContaining(["mcp.write", "api", "api.read"]))
    const { integrationID, attempt, url } = await signIn()
    expect(url.origin + url.pathname).toBe(`${host.fake.origin}/auth/oauth2/authorize`)
    expect(url.searchParams.get("client_id")).toBe(CLIENT_URL)
    expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPE)
    expect(url.searchParams.get("scope")).not.toBe(host.fake.challengeScope)
    await oauth().cancel({ integrationID, attemptID: attempt.attemptID, location: host.location })
  })

  test("Affinity's own error page: the attempt waits with no answer, no credential is stored, and status gives the admin step", async () => {
    host.fake.refuse = "page"
    const { integrationID, attempt, url } = await signIn()
    // The browser opens the link; Affinity answers with its error page and never redirects back.
    const page = await fetch(url, { redirect: "manual" })
    expect(page.status).toBe(400)
    await Bun.sleep(500)
    expect((await attemptStatus(integrationID, attempt.attemptID)).status).toBe("pending")
    await stillSignInRequired()
    await oauth().cancel({ integrationID, attemptID: attempt.attemptID, location: host.location })
  })

  test("a redirect with an error: the attempt fails with Affinity's text, and status is the same", async () => {
    host.fake.refuse = "redirect"
    const { integrationID, attempt, url } = await signIn()
    const redirect = await fetch(url, { redirect: "manual" })
    const callback = redirect.headers.get("location")!
    expect(new URL(callback).hostname).toBe("127.0.0.1")
    // The browser follows the redirect to OpenCode's loopback callback, which shows the error.
    expect((await fetch(callback)).status).toBe(400)
    const failed = await until("the attempt fails", async () => {
      const found = await attemptStatus(integrationID, attempt.attemptID)
      return found.status === "failed" ? found : undefined
    })
    expect(failed.message).toContain("The client is not allowed in this organization")
    await stillSignInRequired()
  })
})
