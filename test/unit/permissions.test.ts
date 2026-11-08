import { describe, expect, test } from "bun:test"
import { DESTRUCTIVE_TOOLS, READ_TOOLS, WORKFLOW_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"
import { ACCESS, defaultRules, effectOf, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"
import { agentEditor, allow, builtInAgents, transforms, type AgentEditor, type FakeAgent } from "./fake.js"

const deny = (action: string): Rule => ({ action, resource: "*", effect: "deny" })
const allowAll = (action: string): Rule => ({ action, resource: "*", effect: "allow" })
const askAll: Rule = { action: "affinity_*", resource: "*", effect: "ask" }
const ACTIONS = ["affinity_search_persons", "affinity_get_lists", "affinity_create_note", "affinity_delete_company", "affinity_shiny_new_tool", "affinity_affinity_meeting_prep"]
const effects = (rules: readonly Rule[]) => ACTIONS.map((action) => evaluate(rules, action))

describe("defaultRules", () => {
  // R18: every tool the plugin registers is allowed at the default, the namespace pattern included.
  test("allow everything by default: the namespace pattern, then every tool, reads and changes alike", () => {
    const rules = defaultRules("all")
    expect(rules[0]).toEqual(allowAll("affinity_*"))
    expect(rules.slice(1)).toEqual([...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((tool) => allowAll(`affinity_${tool}`)))
    expect(effects([allowAll("*"), ...rules])).toEqual(ACTIONS.map(() => "allow"))
  })

  test("ask-changes allows a read and a playbook, and asks for everything else, a tool Affinity adds included", () => {
    const rules = defaultRules("ask-changes")
    expect(rules[0]).toEqual(askAll)
    expect(effects([allowAll("*"), ...rules])).toEqual(["allow", "allow", "ask", "ask", "ask", "allow"])
    for (const tool of READ_TOOLS) expect(evaluate(rules, `affinity_${tool}`)).toBe("allow")
    for (const tool of [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]) expect(evaluate(rules, `affinity_${tool}`)).toBe("ask")
    // R4: a playbook only returns text, so it is a read, and the bulk warning lives in the skill and the docs.
    for (const tool of WORKFLOW_TOOLS) expect({ tool, effect: evaluate(rules, `affinity_${tool}`) }).toEqual({ tool, effect: "allow" })
  })

  test("read-only allows a read and denies everything else, so the destructive class is hidden", () => {
    const rules = defaultRules("read-only")
    expect(rules[0]).toEqual(deny("affinity_*"))
    expect(effects([allowAll("*"), ...rules])).toEqual(["allow", "allow", "deny", "deny", "deny", "allow"])
    for (const tool of DESTRUCTIVE_TOOLS) expect(evaluate(rules, `affinity_${tool}`)).toBe("deny")
  })

  test("the class decides, and the three values cover every class", () => {
    for (const access of ACCESS) {
      expect(effectOf("get_lists", access)).toBe("allow")
      expect(effectOf("affinity_meeting_prep", access)).toBe("allow")
      expect(effectOf("create_note", access)).toBe(access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny")
      expect(effectOf("delete_company", access)).toBe(access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny")
    }
  })
})

describe("insertRules", () => {
  test.each(ACCESS)("splices the %s block right after the base allow, before the agent's own rules", (access) => {
    const rules = defaultRules(access)
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
    const later = [allow("*"), allow("github_*"), ...defaultRules(), allow("affinity_approve_upload")]
    expect(insertRules(later, defaultRules())).toBe(false)
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
    expect(effects(explore.permissions)).toEqual(ACTIONS.map(() => "deny"))
    insertRules(plan.permissions, defaultRules())
    expect(effects(plan.permissions)).toEqual(ACTIONS.map(() => "allow"))
  })

  test("the user's rules come later and win, both ways", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    permissions.push(deny("affinity_create_note"), { action: "affinity_delete_company", resource: "*", effect: "ask" }, deny("affinity_search_*"))
    expect(effects(permissions)).toEqual(["deny", "allow", "deny", "ask", "allow", "allow"])
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
    expect(problems).toEqual(["RULES_NOT_ADDED: Affinity's default permission rules could not be added (boom). Next step: Restart OpenCode."])
  })
})

describe("unguardedAgents", () => {
  test("names no agent under access all, where the block restates the base allow", () => {
    expect(unguardedAgents([{ id: "reviewer", permissions: [allow("*")] }])).toEqual([])
    expect(unguardedAgents([{ id: "reviewer", permissions: [allow("*")] }], "all")).toEqual([])
  })

  test("names agents with a base allow and no block once the access restricts", () => {
    const guarded = [allow("*"), ...defaultRules("read-only")]
    const agents = [
      { id: "build", permissions: guarded },
      { id: "reviewer", permissions: [allow("*")] },
      { id: "fixed", permissions: [allow("*"), ...defaultRules("read-only"), allow("affinity_create_note")] },
      { id: "other-plugin-first", permissions: [allow("*"), allow("github_*"), ...defaultRules("read-only")] },
      { id: "block-before-base", permissions: [...defaultRules("read-only"), allow("*")] },
      { id: "own-allow-no-base", permissions: [allow("affinity_*")] },
    ]
    expect(unguardedAgents(agents, "read-only")).toEqual(["reviewer", "block-before-base"])
    expect(hasDefaultRules(guarded, "read-only")).toBe(true)
    expect(hasDefaultRules([...defaultRules("read-only")], "read-only")).toBe(false)
  })
})
