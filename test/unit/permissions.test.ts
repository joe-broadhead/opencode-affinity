import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { DENIED_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"
import { defaultRules, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"
import { agentEditor, allow, builtInAgents, transforms, type AgentEditor, type FakeAgent } from "./fake.js"

const ask: Rule = { action: "affinity_*", resource: "*", effect: "ask" }
const deny = (action: string): Rule => ({ action, resource: "*", effect: "deny" })
const ACTIONS = ["affinity_search_persons", "affinity_get_current_user", "affinity_create_note", "affinity_send_feedback", "affinity_shiny_new_tool", "affinity_merge_persons"]
const effects = (rules: readonly Rule[]) => ACTIONS.map((action) => evaluate(rules, action))

describe("defaultRules", () => {
  test("ask for every Affinity tool, then allow each known read, then deny the denied tools last", () => {
    const rules = defaultRules()
    expect(rules[0]).toEqual(ask)
    expect(rules.slice(1, 1 + READ_TOOLS.length)).toEqual(READ_TOOLS.map((tool) => ({ action: `affinity_${tool}`, resource: "*", effect: "allow" })))
    expect(rules.slice(1 + READ_TOOLS.length)).toEqual(DENIED_TOOLS.map((tool) => deny(`affinity_${tool}`)))
  })

  test("reads and playbooks allow; every delete, every merge and send_feedback are denied; everything else asks", () => {
    expect(effects([allow("*"), ...defaultRules()])).toEqual(["allow", "allow", "ask", "deny", "ask", "deny"])
    for (const tool of ["delete_company", "delete_reminder", "merge_companies"]) expect(evaluate([allow("*"), ...defaultRules()], `affinity_${tool}`)).toBe("deny")
    for (const tool of ["affinity_meeting_prep", "warm_intro"]) expect(evaluate([allow("*"), ...defaultRules()], `affinity_${tool}`)).toBe("allow")
    for (const tool of ["upsert_list_entry_field_values", "issue_entity_files_download_token"]) expect(evaluate([allow("*"), ...defaultRules()], `affinity_${tool}`)).toBe("ask")
  })

  test("the documented opt-in turns a denied tool back into an ask, never an allow", () => {
    const optIn = { action: "affinity_merge_persons", resource: "*", effect: "ask" as const }
    expect(evaluate([allow("*"), ...defaultRules(), optIn], "affinity_merge_persons")).toBe("ask")
  })
})

describe("insertRules", () => {
  test("splices the rules right after the base allow, before the agent's own rules", () => {
    const rules = defaultRules()
    for (const agent of builtInAgents()) {
      const before = agent.permissions.slice()
      expect(insertRules(agent.permissions, rules)).toBe(true)
      expect(agent.permissions).toEqual([before[0]!, ...rules, ...before.slice(1)])
    }
  })

  test("is idempotent, and finds the block after another plugin's", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    const once = permissions.slice()
    expect(insertRules(permissions, defaultRules())).toBe(false)
    expect(permissions).toEqual(once)
    const later = [allow("*"), allow("github_*"), ...defaultRules(), allow("affinity_create_note")]
    expect(insertRules(later, defaultRules())).toBe(false)
  })

  test("only the whole block counts: the ask rule alone is not the block, so the block is added", () => {
    const own = [allow("*"), { ...ask }, allow("affinity_create_note")]
    expect(hasDefaultRules(own)).toBe(false)
    expect(insertRules(own, defaultRules())).toBe(true)
    expect(own.slice(1, 1 + defaultRules().length)).toEqual(defaultRules())
  })

  test("leaves agents without a base allow untouched and never throws on odd lists", () => {
    for (const permissions of [[], [deny("*")], [allow("read")]] as Rule[][]) {
      const before = permissions.slice()
      expect(insertRules(permissions, defaultRules())).toBe(false)
      expect(permissions).toEqual(before)
    }
  })

  test("stricter agents stay stricter: Explore's own deny still wins", () => {
    const [, plan, explore] = builtInAgents() as [FakeAgent, FakeAgent, FakeAgent]
    insertRules(explore.permissions, defaultRules())
    expect(effects(explore.permissions)).toEqual(["deny", "deny", "deny", "deny", "deny", "deny"])
    insertRules(plan.permissions, defaultRules())
    expect(effects(plan.permissions)).toEqual(["allow", "allow", "ask", "deny", "ask", "deny"])
  })

  test("the user's rules come later and win, both ways", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    permissions.push(allow("affinity_create_note"), { action: "affinity_send_feedback", resource: "*", effect: "ask" }, deny("affinity_search_*"))
    expect(effects(permissions)).toEqual(["deny", "allow", "allow", "ask", "ask", "deny"])
  })
})

describe("registerDefaultRules", () => {
  test("adds the rules to every agent once per rebuild and reports no problem", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const agents = builtInAgents()
      run(agentEditor(agents))
      for (const agent of agents) expect(agent.permissions.filter((rule) => rule.action === "affinity_*")).toHaveLength(1)
    }
    expect(problems).toEqual([undefined, undefined])
  })

  test("never throws; a failure is reported for status", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    const broken = { ...agentEditor([]), list: () => { throw new Error("boom") } }
    expect(() => run(broken)).not.toThrow()
    expect(problems).toEqual([
      "RULES_NOT_ADDED: Affinity's default permission rules could not be added (boom), so Affinity tools may run without asking. Next step: Restart OpenCode.",
    ])
  })
})

describe("unguardedAgents", () => {
  test("names agents with a base allow, no block, and rules that would let a new Affinity tool run", () => {
    const guarded = [allow("*"), ...defaultRules()]
    const agents = [
      { id: "build", permissions: guarded },
      { id: "reviewer", permissions: [allow("*")] },
      { id: "fixed", permissions: [allow("*"), ...defaultRules(), allow("affinity_create_note")] },
      { id: "other-plugin-first", permissions: [allow("*"), allow("github_*"), ...defaultRules()] },
      { id: "block-before-base", permissions: [...defaultRules(), allow("*")] },
      { id: "ask-rule-only", permissions: [allow("*"), { ...ask }] },
      { id: "locked", permissions: [allow("*"), deny("*")] },
      { id: "denies-affinity", permissions: [allow("*"), deny("affinity_*")] },
      // No base allow: the plugin adds no rules there, and nothing needs fixing.
      { id: "own-allow-no-base", permissions: [allow("affinity_*")] },
    ]
    expect(unguardedAgents(agents)).toEqual(["reviewer", "block-before-base"])
    expect(hasDefaultRules(guarded)).toBe(true)
    expect(hasDefaultRules([...defaultRules()])).toBe(false)
  })
})

// The reconcile is a drop-in: replacing test/unit/affinity-tools-list.json with the live `tools/list` and adding the names
// to src/affinity-tools.ts must leave every tool decided by one rule, and every deny still hidden. A live name nobody
// classified, or a read whose rule went missing, is caught here rather than by a prompt the firm did not expect.
describe("a saved tool list drops in", () => {
  const saved = JSON.parse(readFileSync(new URL("./affinity-tools-list.json", import.meta.url), "utf8")) as { tools: { name: string }[] }
  const names = saved.tools.map((tool) => tool.name)
  const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)
  /** The last rule that decides a tool, as the host evaluates it. */
  const deciding = (name: string, rules: readonly Rule[]) => rules.findLast((rule) => wildcard(rule.action).test(`affinity_${name}`) && wildcard(rule.resource).test("*"))
  /** The names with no list of their own: a live tool the plugin has never classified. */
  const unclassified = (list: readonly string[]) => list.filter((name) => ![READ_TOOLS, WRITE_TOOLS, DENIED_TOOLS].some((known) => known.includes(name)))
  /** Reads whose own allow rule went missing: they then fall to the catch-all ask. */
  const unruledReads = (list: readonly string[], rules: readonly Rule[]) =>
    list.filter((name) => READ_TOOLS.includes(name) && rules.filter((rule) => rule.action === `affinity_${name}` && rule.effect === "allow").length !== 1)

  test("every tool in the saved list is classified, and one rule decides it as its class says", () => {
    const rules = defaultRules()
    expect(unclassified(names)).toEqual([])
    for (const name of names) {
      const effect = deciding(name, rules)?.effect
      const expected = READ_TOOLS.includes(name) ? "allow" : WRITE_TOOLS.includes(name) ? "ask" : "deny"
      expect({ name, effect }).toEqual({ name, effect: expected })
      expect(evaluate([allow("*"), ...rules], `affinity_${name}`)).toBe(expected)
    }
  })

  test("every deny is the last rule that matches it, so the tool stays hidden", () => {
    const rules = defaultRules()
    for (const name of DENIED_TOOLS) {
      expect(rules.filter((rule) => rule.action === `affinity_${name}`).at(-1)?.effect).toBe("deny")
      expect(deciding(name, rules)?.effect).toBe("deny")
    }
  })

  test("the check fails on a tool with no rule of its own, or one nobody classified", () => {
    // A live read added without its allow rule falls to the catch-all ask: caught.
    expect(unruledReads(names, defaultRules().filter((rule) => rule.action !== "affinity_get_lists"))).toEqual(["get_lists"])
    // A live name added to the fixture but never classified: caught.
    expect(unclassified([...names, "a_tool_added_later"])).toEqual(["a_tool_added_later"])
    // A deny reordered behind another rule no longer decides its tool: caught.
    const reopened = [...defaultRules(), { action: "affinity_delete_company", resource: "*", effect: "allow" as const }]
    expect(deciding("delete_company", reopened)?.effect).toBe("allow")
  })
})
