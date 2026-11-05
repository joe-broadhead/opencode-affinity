import { describe, expect, test } from "bun:test"
import { checkHost } from "../../src/host-version.js"
import { defaultRules } from "../../src/permissions.js"
import { ADMIN_STEP, buildStatus, formatStatus, readStatus, registerStatusCommand, registerStatusRpc, shortReason, SIGN_IN, StatusRpc, type Status, type StatusContext, type StatusFacts } from "../../src/status.js"
import { VERSION } from "../../src/version.js"
import { allow } from "./fake.js"

const ADMIN_STEP_OWN = " If your own mcp.servers.affinity entry uses your organisation's own OAuth app, ask for that app to be allowed instead."
const NOTHING_TO_DO = "Nothing to do."
/** The default rules as /affinity-status shows them: one rule a line, a JSON array body. */
const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")

const host = checkHost("2.2.3", false)
const URL = "https://mcp.affinity.co/mcp"
const base: StatusFacts = { server: { status: "connected" }, source: { type: "plugin", url: URL, signIn: "oauth" }, host, tools: ["search_persons"] }
const guarded = { id: "build", permissions: [allow("*"), ...defaultRules()] }
const RULES = "no agent runs new Affinity tools unasked"

describe("buildStatus", () => {
  test("connected, with the account read, and nothing left to do", () => {
    const status = buildStatus({ ...base, account: { organisation: "Northwind Capital", grant: "read-write" }, agents: [guarded] })
    expect(status).toEqual({
      version: VERSION,
      state: "connected",
      source: { type: "plugin", url: URL, signIn: "oauth" },
      organisation: "Northwind Capital",
      grant: "read-write",
      adminStep: null,
      everConnected: false,
      tools: 1,
      deniedTools: [],
      listing: false,
      unknownCount: 0,
      unknownTools: [],
      unguardedAgents: [],
      host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
      problems: [],
      nextStep: "Nothing to do.",
    })
    expect(formatStatus(status)).toBe(
      [
        "Affinity status",
        "- Connection: connected (https://mcp.affinity.co/mcp, registered by this plugin)",
        "- Account: Northwind Capital",
        `- Access: Affinity grant: read and write; ${RULES}`,
        "- Organisation setup: done: this Affinity organisation lets OpenCode sign in",
        "- Tools: 1 available, 0 unknown",
        "- Agents without default rules: none",
        "- OpenCode: 2.2.3 (tested; supported range >=2.2.3 <2.3.0)",
        "- Next step: Nothing to do.",
      ].join("\n"),
    )
  })

  test("before any account read, the organisation and grant say so, and are null in the RPC", () => {
    const status = buildStatus(base)
    expect([status.organisation, status.grant]).toEqual([null, null])
    const text = formatStatus(status)
    expect(text).toContain("- Account: not read yet (it appears after the first affinity_get_current_user call since OpenCode started)")
    expect(text).toContain(`- Access: Affinity grant not read yet; ${RULES}`)
  })

  test("a read-only grant says Affinity refuses changes, and an API key says it has full access", () => {
    expect(formatStatus(buildStatus({ ...base, account: { grant: "read-only" } }))).toContain(`- Access: Affinity grant: read-only, so Affinity refuses changes; ${RULES}\n`)
    expect(formatStatus(buildStatus({ ...base, account: { grant: "api-key" } }))).toContain(`- Access: Affinity grant: API key (full access); ${RULES}\n`)
  })

  test("a first sign-in that Affinity may refuse gives the admin step; a renewal does not", () => {
    const status = buildStatus({ ...base, server: { status: "needs_auth" } })
    expect(status).toMatchObject({ state: "sign_in_required", adminStep: ADMIN_STEP, everConnected: false, nextStep: SIGN_IN })
    expect(formatStatus(status)).toContain(`- Organisation setup: ${ADMIN_STEP}\n`)
    // A sign-in that worked before and now needs one again is an expiry: no admin step, and the next step is /connect.
    const renewal = buildStatus({ ...base, server: { status: "needs_auth" }, everConnected: true })
    expect(renewal).toMatchObject({ state: "sign_in_required", adminStep: null, everConnected: true, nextStep: SIGN_IN })
    expect(formatStatus(renewal)).toContain("- Organisation setup: done earlier: the sign-in has expired, so run /connect again\n")
    expect(formatStatus(renewal)).not.toContain("OpenCode's client URL")
    // Other states carry no admin step: connected through OAuth says the organisation allows OpenCode.
    expect(buildStatus(base).adminStep).toBeNull()
    expect(formatStatus(buildStatus({ ...base, server: { status: "pending" } }))).toContain(
      "- Organisation setup: once per Affinity organisation, an admin adds OpenCode's client URL, https://opencode.ai/oauth/opencode/client.json, under Settings, Manage Apps\n",
    )
    // AF-8: an adopted entry may use the organisation's own OAuth app, so the step says so.
    const adopted = buildStatus({ ...base, server: { status: "needs_auth" }, source: { type: "adopted", url: URL, signIn: "oauth" } })
    expect(adopted.adminStep).toBe(ADMIN_STEP + ADMIN_STEP_OWN)
    expect(formatStatus(buildStatus({ ...base, source: { type: "adopted", url: URL, signIn: "own" } }))).toContain("- Organisation setup: not needed: your own entry signs in with an API key\n")
  })

  test("shows a failure's reason on one short line, without URL queries, and never the text of a needed sign-in", () => {
    const failed = buildStatus({ ...base, server: { status: "failed", error: "SSE error:\n  fetch https://mcp.affinity.co/mcp?token=secret-123 failed.\n" } })
    expect(failed.error).toBe("SSE error: fetch https://mcp.affinity.co/mcp failed")
    expect(formatStatus(failed)).toContain(`- Connection: failed (SSE error: fetch https://mcp.affinity.co/mcp failed; ${URL}, registered by this plugin)`)
    expect(shortReason("word ".repeat(100))).toHaveLength(160)
    expect(shortReason(" \n. ")).toBeUndefined()
    const signIn = buildStatus({ ...base, server: { status: "needs_auth", error: "Visit https://login.affinity.co/auth/oauth2/authorize?code=abc to sign in" } })
    expect(signIn.error).toBeUndefined()
    expect(formatStatus(signIn)).not.toContain("authorize")
  })

  test("adopted and conflicting servers", () => {
    expect(formatStatus(buildStatus({ ...base, source: { type: "adopted", url: URL, signIn: "oauth" } }))).toContain(`- Connection: connected (${URL}, your own mcp.servers.affinity, used unchanged)`)
    const conflict = buildStatus({ ...base, source: { type: "conflict", url: "https://affinity.example.com/mcp", expected: URL } })
    expect(conflict.state).toBe("conflict")
    expect(conflict.nextStep).toBe(
      `Your OpenCode config defines mcp.servers.affinity with https://affinity.example.com/mcp, but the plugin uses ${URL}. Point it at ${URL} or remove it, then restart OpenCode.`,
    )
    expect(formatStatus(conflict)).toContain("- Connection: conflict (your mcp.servers.affinity points at https://affinity.example.com/mcp)")
  })

  test("the user's own entry without OAuth is named as such, and its failure points at the API key it sends", () => {
    const own = { type: "adopted", url: URL, signIn: "own" } as const
    expect(formatStatus(buildStatus({ ...base, source: own }))).toContain(`- Connection: connected (${URL}, your own mcp.servers.affinity without OAuth, used unchanged)`)
    expect(buildStatus({ ...base, source: own, server: { status: "failed", error: "HTTP 401" } }).nextStep).toBe(
      "Check your network and the API key in the headers of your own mcp.servers.affinity (Affinity: Settings, Manage Apps), then restart OpenCode.",
    )
  })

  test("counts the available tools, names the unknown ones, and counts denied ones apart; missing known tools are normal", () => {
    const status = buildStatus({ ...base, tools: ["search_persons", "create_note", "send_feedback", "shiny_new_tool", "summarize_portfolio"] })
    expect(status.tools).toBe(4)
    expect(status.deniedTools).toEqual(["send_feedback"])
    expect(status.unknownCount).toBe(2)
    expect(status.unknownTools).toEqual(["shiny_new_tool", "summarize_portfolio"])
    expect(formatStatus(status)).toContain("- Tools: 4 available, 2 unknown: shiny_new_tool, summarize_portfolio (unknown tools ask before running); off by default: send_feedback\n")
    expect(status.nextStep).toBe(NOTHING_TO_DO)
    const denied = buildStatus({ ...base, tools: ["search_persons", "merge_persons", "send_feedback"] })
    expect(formatStatus(denied)).toContain("- Tools: 1 available, 0 unknown; off by default: merge_persons and send_feedback\n")
  })

  test("a server that just connected and lists no tools yet is still listing them", () => {
    const listing = buildStatus({ ...base, tools: [], settling: true })
    expect(listing).toMatchObject({ state: "connected", tools: 0, listing: true, nextStep: "Affinity is still listing its tools. Run /affinity-status again in a few seconds." })
    const text = formatStatus(listing)
    expect(text).toContain("- Connection: connected (https://mcp.affinity.co/mcp, registered by this plugin; still listing its tools)")
    expect(text).toContain("- Tools: none listed yet (Affinity is still listing them)")
    // Settled, with no tools: Affinity has no per-account switch to point at, so nothing is left to do.
    expect(buildStatus({ ...base, tools: [], settling: false }).nextStep).toBe(NOTHING_TO_DO)
    // Not connected: the connection's own step, never "listing".
    expect(buildStatus({ ...base, tools: [], settling: true, server: { status: "pending" } })).toMatchObject({ listing: false, state: "connecting" })
  })

  test("the Access row says whether the default rules are in place, from what status can see", () => {
    expect(formatStatus(buildStatus(base))).toContain("- Access: Affinity grant not read yet; no agent runs new Affinity tools unasked\n")
    const missing = buildStatus({ ...base, agents: [{ id: "reviewer", permissions: [allow("*")] }] })
    expect(formatStatus(missing)).toContain("- Access: Affinity grant not read yet; default rules missing in the agents listed below\n")
    const problem = "RULES_NOT_ADDED: Affinity's default permission rules could not be added (boom), so Affinity tools may run without asking. Next step: Restart OpenCode."
    expect(formatStatus(buildStatus({ ...base, account: { grant: "read-write" }, problems: [problem] }))).toContain("- Access: Affinity grant: read and write; default rules not added (see the OpenCode row)\n")
  })

  test("a failure's reason never carries a token or key the host's text echoed", () => {
    const failed = buildStatus({ ...base, server: { status: "failed", error: "HTTP 401 for Authorization: Bearer sk-fake-abcdef123456 and api_key=fake-key-000111" } })
    expect(failed.error).toBeDefined()
    expect(failed.error).not.toMatch(/sk-fake|abcdef123456|fake-key-000111/)
  })

  test("names at most 20 unknown tools, and only plain names, but counts them all", () => {
    const odd = ["Bad Name", "x".repeat(70), "evil\u001b[31m", "-dash"]
    const many = Array.from({ length: 25 }, (_, index) => `new_tool_${index}`)
    const status = buildStatus({ ...base, tools: ["search_persons", ...odd, ...many] })
    expect(status.unknownCount).toBe(29)
    expect(status.unknownTools).toEqual(many.slice(0, 20))
    expect(formatStatus(status)).toContain(`- Tools: 30 available, 29 unknown: ${many.slice(0, 20).join(", ")} and 9 more (unknown tools ask before running)`)
    expect(formatStatus(buildStatus({ ...base, tools: odd }))).toContain("- Tools: 4 available, 4 unknown (unknown tools ask before running)")
  })

  test("names agents without the default rules, with the block to paste, and points the next step at it", () => {
    const status = buildStatus({ ...base, agents: [guarded, { id: "reviewer", permissions: [allow("*")] }] })
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.nextStep).toBe(
      "Put the default rules shown by /affinity-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Affinity tools.",
    )
    expect(JSON.parse(`[${AGENT_RULES}]`)).toEqual(defaultRules())
    expect(formatStatus(status)).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n- OpenCode:`)
  })

  test("an agent whose own rules already ask or deny for every Affinity tool is not listed", () => {
    const agents = [
      { id: "asks-everything", permissions: [allow("*"), { action: "*", resource: "*", effect: "ask" as const }] },
      { id: "denies-affinity", permissions: [allow("*"), { action: "affinity_*", resource: "*", effect: "deny" as const }] },
      { id: "reviewer", permissions: [allow("*")] },
    ]
    expect(buildStatus({ ...base, agents }).unguardedAgents).toEqual(["reviewer"])
  })

  test("the sign-in step comes before the agent fix, which still shows, and there is one next step", () => {
    const status = buildStatus({ ...base, server: { status: "needs_auth", error: "x" }, agents: [{ id: "reviewer", permissions: [allow("*")] }] })
    expect(status.nextStep).toBe(SIGN_IN)
    const text = formatStatus(status)
    expect(text).toContain(`- Connection: sign-in required (${URL}, registered by this plugin)`)
    expect(text).toContain("- Agents without default rules: reviewer\n")
    expect(text.match(/Next step/g)).toHaveLength(1)
  })

  test("the rows come in the standard order, with Organisation setup between Access and Tools", () => {
    const rows = formatStatus(buildStatus(base)).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2, line.indexOf(":")))
    expect(rows).toEqual(["Connection", "Account", "Access", "Organisation setup", "Tools", "Agents without default rules", "OpenCode", "Next step"])
  })

  test("a skill of the same id at another path shadows the plugin's: status names it, after any other next step", () => {
    const own = [{ id: "affinity", path: "/pkg/skills/affinity/SKILL.md" }, { id: "affinity-write", path: "/pkg/skills/affinity-write/SKILL.md" }]
    const listed = [{ id: "affinity", path: "/projects/acme/.opencode/skills/affinity/SKILL.md" }, own[1]!, { id: "other", path: "/x" }]
    const status = buildStatus({ ...base, skills: { own, listed } })
    expect(status.shadowedSkills).toEqual([{ id: "affinity", path: "/projects/acme/.opencode/skills/affinity/SKILL.md" }])
    expect(status.nextStep).toBe(
      'Rename or move the "affinity" skill at /projects/acme/.opencode/skills/affinity/SKILL.md, which OpenCode loads instead of the plugin\'s skill of the same name.',
    )
    expect(buildStatus({ ...base, skills: { own, listed: own } })).not.toHaveProperty("shadowedSkills")
    expect(buildStatus({ ...base, skills: { own, listed }, agents: [{ id: "reviewer", permissions: [allow("*")] }] }).nextStep).toStartWith("Put the default rules")
  })

  test("an untested host and setup problems show on the OpenCode row; a problem's own next step comes first", () => {
    const outside = checkHost("2.3.0", true)
    const problem = 'SKILLS_INVALID: The "affinity" skill was not loaded: skills/affinity/SKILL.md is missing. Next step: Reinstall the plugin.'
    const status = buildStatus({ ...base, host: outside, problems: [problem] })
    expect(status.nextStep).toBe("Reinstall the plugin.")
    expect(formatStatus(status)).toContain(
      `- OpenCode: 2.3.0 (untested; supported range >=2.2.3 <2.3.0). It is outside the supported range; the plugin runs because allowUntestedHost is true. If Affinity misbehaves, use OpenCode 2.2.3, 2.2.4 or 2.2.5. ${problem}`,
    )
    expect(buildStatus({ ...base, host: outside }).nextStep).toBe(NOTHING_TO_DO)
    const inside = buildStatus({ ...base, host: checkHost("2.2.6", false) })
    expect(inside).toMatchObject({ state: "connected", host: { version: "2.2.6", tested: false }, nextStep: NOTHING_TO_DO })
    expect(buildStatus({ ...base, host: checkHost("2.2.6", false), server: { status: "needs_auth" } }).nextStep).toBe(SIGN_IN)
    expect(formatStatus(inside)).toContain("- OpenCode: 2.2.6 (untested; supported range >=2.2.3 <2.3.0)\n")
    expect(formatStatus(buildStatus({ ...base, host: checkHost("2.2.5", false) }))).toContain("- OpenCode: 2.2.5 (tested; supported range >=2.2.3 <2.3.0)\n")
  })
})

function statusContext(server: string, skills: Promise<unknown> = Promise.resolve({ data: [] })) {
  const ctx = {
    mcp: { list: async () => ({ data: [{ name: "github", status: { status: "connected" } }, { name: "affinity", status: { status: server } }] }) },
    agent: { list: async () => ({ data: [guarded, { id: "reviewer", permissions: [allow("*")] }] }) },
    tool: {
      list: async () => [
        { id: "affinity_search_persons", name: "search_persons", options: { namespace: "affinity" } },
        { id: "affinity_shiny_new_tool", name: "shiny_new_tool", options: { namespace: "affinity" } },
        { id: "other_search", name: "search", options: { namespace: "other" } },
        { id: "read", name: "read" },
      ],
    },
    skill: { list: () => skills },
  }
  return ctx as unknown as StatusContext
}

describe("readStatus", () => {
  const account = () => {
    let current: { organisation: string } | undefined = { organisation: "Northwind Capital" }
    return { current: () => current, forget: () => void (current = undefined), changedAt: () => 0, everConnected: () => false }
  }

  test("reads connection, the captured account, tools and agents through public APIs", async () => {
    const status = await readStatus(statusContext("connected"), { source: { type: "plugin", url: URL, signIn: "oauth" }, host, problems: [], account: account() })
    expect(status).toMatchObject({ state: "connected", organisation: "Northwind Capital", tools: 2, unknownTools: ["shiny_new_tool"], unguardedAgents: ["reviewer"] })
  })

  test("a server that needs a new sign-in forgets the account read before it", async () => {
    const captured = account()
    const status = await readStatus(statusContext("needs_auth"), { host, account: captured })
    expect(status.organisation).toBeNull()
    expect(captured.current()).toBeUndefined()
  })

  test("names shadowed skills from the host's list, and a failed skill list hides nothing else", async () => {
    const own = [{ id: "affinity", path: "/pkg/skills/affinity/SKILL.md" }]
    const listed = Promise.resolve({ data: [{ id: "affinity", path: "/home-skills/affinity/SKILL.md" }] })
    expect((await readStatus(statusContext("connected", listed), { host, skills: own })).shadowedSkills).toEqual([{ id: "affinity", path: "/home-skills/affinity/SKILL.md" }])
    const failed = await readStatus(statusContext("connected", Promise.reject(new Error("offline"))), { host, skills: own })
    expect(failed).toMatchObject({ state: "connected", tools: 2 })
    expect(failed).not.toHaveProperty("shadowedSkills")
  })
})

describe("/affinity-status", () => {
  async function run(read: () => Promise<Status>) {
    const posted: unknown[] = []
    let execute: ((input: { sessionID: string }) => Promise<void>) | undefined
    await registerStatusCommand(
      {
        command: { transform: async (callback) => (callback({ add: (definition) => void (execute = definition.execute as never) }), { dispose: async () => {} }) },
        session: { synthetic: async (input) => (posted.push(input), {}) as never },
      },
      read,
    )
    await execute!({ sessionID: "ses_1" })
    return posted
  }

  test("posts the status text into the session without starting a turn", async () => {
    const posted = await run(async () => buildStatus(base))
    expect(posted).toEqual([{ sessionID: "ses_1", text: formatStatus(buildStatus(base)), description: "Affinity status", resume: false }])
  })

  test("posts a coded error with a next step, cut to one short line without URL queries, when status cannot be read", async () => {
    const posted = (await run(() => Promise.reject(new Error("failed:\n https://x.example/a?token=t")))) as { text: string }[]
    expect(posted[0]!.text).toBe("STATUS_UNAVAILABLE: Could not read Affinity's status (failed: https://x.example/a). Next step: Restart OpenCode, then run /affinity-status again.")
  })
})

describe("status RPC", () => {
  async function register(read: () => Promise<Status>) {
    const registered: { id: string; methods: string[]; status: () => Promise<unknown> }[] = []
    const error = (type: string, message: string, data: unknown) => ({ type, message, data })
    await registerStatusRpc(
      {
        register: async (definition, handlers) => {
          registered.push({ id: definition.id, methods: Object.keys(definition.methods), status: () => handlers.status({} as never, { error } as never) })
          return { dispose: async () => {}, events: { emit: async () => {} } } as never
        },
      },
      read,
    )
    return registered
  }

  test("serves the same status as /affinity-status through one read-only method", async () => {
    const registered = await register(async () => buildStatus(base))
    expect(registered.map(({ id, methods }) => ({ id, methods }))).toEqual([{ id: "affinity.crm", methods: ["status"] }])
    expect(await registered[0]!.status()).toEqual(buildStatus(base))
    expect(StatusRpc.events).toEqual({})
  })

  test("answers a status it cannot read with its declared error, unavailable, and a next step", async () => {
    const registered = await register(() => Promise.reject(new Error("agent list failed")))
    expect(await registered[0]!.status()).toEqual({
      type: "unavailable",
      message: "STATUS_UNAVAILABLE: Could not read Affinity's status (agent list failed).",
      data: { nextStep: "Restart OpenCode, then run /affinity-status again." },
    })
    expect(Object.keys(StatusRpc.methods.status.errors)).toEqual(["unavailable"])
  })

  test("has the fields every plugin of this family shares, with their names", () => {
    const status = buildStatus(base)
    expect({ version: status.version, host: status.host, state: status.state, unguardedAgents: status.unguardedAgents, nextStep: status.nextStep }).toEqual({
      version: VERSION,
      host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
      state: "connected",
      unguardedAgents: [],
      nextStep: NOTHING_TO_DO,
    })
    expect(StatusRpc.methods.status.output.required).toEqual(expect.arrayContaining(["version", "host", "state", "unguardedAgents", "nextStep"]))
  })

  test("the output schema names every status field and requires the ones always present", () => {
    const { properties, required } = StatusRpc.methods.status.output
    const statuses: Status[] = [
      buildStatus({ ...base, account: { organisation: "Acme", grant: "read-only" }, tools: ["shiny_new_tool"], agents: [{ id: "reviewer", permissions: [allow("*")] }], problems: ["p"], skills: { own: [{ id: "affinity", path: "/a" }], listed: [{ id: "affinity", path: "/b" }] } }),
      buildStatus({ ...base, server: { status: "failed", error: "fetch failed" }, source: { type: "conflict", url: "https://x.example/mcp", expected: URL }, host: checkHost("2.3.0", true) }),
    ]
    for (const status of statuses) {
      expect(Object.keys(status).filter((key) => !(key in properties))).toEqual([])
      expect(required.filter((key) => !(key in status))).toEqual([])
      expect(Object.keys(status.host).filter((key) => !(key in properties.host.properties))).toEqual([])
    }
  })
})
