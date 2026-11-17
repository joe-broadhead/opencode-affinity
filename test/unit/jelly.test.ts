import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { DESTRUCTIVE_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"
import { parseOptions } from "../../src/options.js"
import { ACCESS, defaultRules, evaluate } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { ACCESS_CHOICES, settingChoices, type PluginSetting, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base allow
 * rule, so this plugin's own rules never reach them: Jelly writes each declared "ask" or "deny" as that tool's default.
 */

type Tool = { name: string; permission: string; effect: "allow" | "ask" | "deny"; readOnly: boolean }
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  files: string[]
  jelly: {
    title: string
    summary: string
    icon: string
    admin: string
    tools: Tool[]
    skills: string[]
    rpc: unknown[]
    views: unknown[]
    signIns: unknown[]
    contributes: { homeFeeds: unknown[]; homeWidgets: unknown[]; workKinds: unknown[]; settings: PluginSetting[] }
  }
}
const { jelly } = pkg
const { settings } = jelly.contributes
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))

describe("the jelly declaration", () => {
  test("declares every known tool once, every one allowed, and marks the reads read-only", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`affinity_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    for (const tool of [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]) expect(byPermission.get(`affinity_${tool}`)).toMatchObject({ effect: "allow", readOnly: false })
    expect(jelly.tools).toHaveLength(READ_TOOLS.length + WRITE_TOOLS.length + DESTRUCTIVE_TOOLS.length)
    expect([...byPermission.keys()].sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((tool) => `affinity_${tool}`).sort())
  })

  // R18: every declared tool is allowed, which is what the plugin's own default block says for all of them.
  test("each declared effect is allow, and the plugin's default rules allow every tool", () => {
    const rules = [{ action: "*", resource: "*", effect: "allow" as const }, ...defaultRules()]
    for (const tool of jelly.tools) {
      expect(tool.effect).toBe("allow")
      expect([tool.permission, evaluate(rules, tool.permission)]).toEqual([tool.permission, tool.effect])
    }
  })

  test("each tool's name is its Code Mode path, and its permission the host's action", () => {
    for (const tool of jelly.tools) {
      expect(tool.name).toStartWith(`${SERVER_NAME}.`)
      expect(tool.name.replaceAll(".", "_")).toBe(tool.permission)
      expect(Object.keys(tool).sort()).toEqual(["effect", "name", "permission", "readOnly"])
    }
  })

  test("uses only the keys Jelly reads: its contracts strip any other", () => {
    expect(Object.keys(jelly).sort()).toEqual(["admin", "contributes", "icon", "rpc", "signIns", "skills", "summary", "title", "tools", "views"])
  })

  test("states the admin step, which ends 'Before anyone signs in, your admin needs to …': one line of at most 200 characters", () => {
    expect(jelly.admin.length).toBeLessThanOrEqual(200)
    expect(jelly.admin).toBe(jelly.admin.trim())
    expect(jelly.admin).not.toContain("\n")
    // Both routes: OpenCode's client URL, or the organisation's own Public OAuth app for the Client ID setting.
    expect(jelly.admin).toContain("Client URL https://opencode.ai/oauth/opencode/client.json")
    expect(jelly.admin).toContain("a Public OAuth app for the Client ID setting")
    expect(jelly.admin).toContain("offline_access")
  })

  test("names every skill the package ships, the one sign-in, and no views, RPC, feeds or widgets", () => {
    expect(jelly.title).toBe(DISPLAY_NAME)
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../../skills", import.meta.url)).sort())
    expect(jelly.skills).toEqual([...SKILL_NAMES])
    expect(jelly.signIns).toEqual([{ id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME }])
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    // The access option, allowed by default, with Jelly's own words for its three values, and the free-text clientId.
    expect(jelly.contributes).toEqual({
      homeFeeds: [],
      homeWidgets: [],
      workKinds: [],
      settings: [
        {
          key: "access",
          label: "Access",
          type: "string",
          description: "How much the plugin's tools may do. Generates default rules for agents with a base allow rule.",
          choices: ACCESS_CHOICES,
          default: "all",
        },
        {
          key: "clientId",
          label: "Client ID",
          type: "string",
          description:
            "Optional. The client ID, a UUID, of your organisation's own Public OAuth app in Affinity (Settings > Manage Apps). Leave it empty to sign in with OpenCode's client URL, which an Affinity admin adds once. Not a secret.",
        },
      ],
    })
  })

  test("the settings follow Jelly's rules for a declared setting", () => {
    expect(settingsProblems(settings)).toEqual([])
  })

  test("the options parser takes every declared access choice, its default included, and refuses a value outside them", () => {
    const access = settings.find((setting) => setting.key === "access")!
    const values = (settingChoices(access) ?? []).map((choice) => choice.value)
    expect(values).toEqual([...ACCESS])
    for (const value of values) expect<string>(parseOptions({ access: value }).access).toBe(value)
    expect<string>(parseOptions({}).access).toBe(access.default as string)
    expect(settingValueIssue(access, "write")).not.toBeNull()
    expect(() => parseOptions({ access: "write" })).toThrow("OPTIONS_INVALID")
  })

  // Jelly draws a string setting without a closed set as free text, with no pattern, and saves a cleared field as "".
  test("the clientId setting is free text with no default; the options parser takes a UUID and an empty value, and refuses anything else", () => {
    const clientId = settings.find((setting) => setting.key === "clientId")!
    expect(settingChoices(clientId)).toBeUndefined()
    expect(clientId).not.toHaveProperty("default")
    const id = "00000000-1111-4222-8333-444444444444"
    expect(settingValueIssue(clientId, id)).toBeNull()
    expect(parseOptions({ clientId: id }).clientId).toBe(id)
    expect(parseOptions({ clientId: "" })).not.toHaveProperty("clientId")
    // Jelly saves any text; the plugin refuses what is not a client ID when it starts.
    expect(settingValueIssue(clientId, "my-client")).toBeNull()
    expect(() => parseOptions({ clientId: "my-client" })).toThrow("OPTIONS_INVALID")
  })

  test("the summary is one line of 1 to 120 characters", () => {
    expect(jelly.summary.trim().length).toBeGreaterThan(0)
    expect(jelly.summary.length).toBeLessThanOrEqual(120)
    expect(jelly.summary).not.toContain("\n")
  })
})
