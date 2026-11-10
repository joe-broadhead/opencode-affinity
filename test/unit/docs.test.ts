// The docs and skills must match the code: tool names, the deny rule, error codes, the uninstall order and the Jelly
// guide. They state no tool counts, so a change to src/affinity-tools.ts cannot leave a stale number behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { CODES, TESTED_HOSTS, UNTESTED_EXAMPLE } from "../../src/constants.js"
import { DESTRUCTIVE_TOOLS, PARAMETERS, READ_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"
import { METHODS, NEXT_STEPS, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { ACCESS, defaultRules } from "../../src/permissions.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
// Everything a user or the model reads about the current release.
const FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "AGENTS.md",
  ...readdirSync(join(ROOT, "docs")).map((name) => `docs/${name}`),
  ...readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`),
]
const KNOWN = [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]
const raw = (file: string) => readFileSync(join(ROOT, file), "utf8")
const text = (file: string) => raw(file).replace(/\s+/g, " ")

describe("docs", () => {
  test.each(FILES)("%s states no count of read, write or declared tools that could go stale", (file) => {
    const counts = [...text(file).matchAll(/\b\d+ (?:known )?(?:read|write)(?:s\b| tools\b| read-only)|\b\d+ tools are declared/g)].map((match) => match[0])
    const stale = counts.filter((count) => !count.startsWith(`${READ_TOOLS.length} read`) && !count.startsWith(`${WRITE_TOOLS.length} write`))
    expect(stale).toEqual([])
  })

  test.each(FILES)("%s names only Affinity tools the plugin knows", (file) => {
    // affinity_<tool>; a playbook's own name, such as affinity_meeting_prep, also starts with affinity_.
    const named = [...text(file).matchAll(/\baffinity_([a-z][a-z_]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => !KNOWN.includes(tool) && !KNOWN.includes(`affinity_${tool}`))).toEqual([])
  })

  test.each(["README.md", "docs/configuration.md", "docs/scripting.md", "docs/jelly.md", "SECURITY.md"])("%s says nothing provisional or pending", (file) => {
    expect(text(file)).not.toMatch(/provisional|not yet (?:checked|published|signed)|private package|TODO/i)
  })

  // The one exception is the install spec, which names the release tag by design (the GitHub install takes `#v0.0.0`).
  test("the README names no version of the plugin, except its install spec", () => {
    expect(text("README.md").replace("opencode-affinity#v0.0.0", "")).not.toMatch(/opencode-affinity@\d|\b0\.\d+\.\d+\b|\bv\d+\.\d+\.\d+\b/)
  })

  // R7 with R18: the block for each access value is in the README, generated from defaultRules(access).
  test("the README prints the whole default-rules block for each access value, and each equals defaultRules(access)", () => {
    const blocks = [...raw("README.md").matchAll(/```json\n(\[[\s\S]*?\])\n```/g)].map((match) => JSON.parse(match[1]!) as { action: string; effect: string }[])
    const arrays = blocks.filter((value) => Array.isArray(value) && value.some((rule) => rule?.action === "affinity_*"))
    for (const access of ACCESS) {
      const expected = defaultRules(access)
      const found = arrays.filter((value) => JSON.stringify(value) === JSON.stringify(expected))
      expect({ access, found: found.length }).toEqual({ access, found: 1 })
    }
    for (const value of blocks) if (Array.isArray(value)) for (const rule of value) expect(typeof rule).toBe("object")
    expect(/## Permissions\n\n\*\*Every tool is allowed by default\.\*\*/.test(raw("README.md"))).toBe(true)
    // Every destructive tool is asked for under ask-changes and denied under read-only.
    const effectIn = (access: "ask-changes" | "read-only", tool: string) => defaultRules(access).find((rule) => rule.action === `affinity_${tool}`)?.effect
    for (const tool of DESTRUCTIVE_TOOLS) expect([effectIn("ask-changes", tool), effectIn("read-only", tool)]).toEqual(["ask", "deny"])
  })

  test("no doc or skill gives a destructive tool an allow rule outside the generated block", () => {
    for (const file of FILES) {
      const source = raw(file)
      for (const tool of DESTRUCTIVE_TOOLS) {
        const rules = [...source.matchAll(/\{[^{}]*\}/g)].map((match) => match[0])
        const allowed = rules.filter((rule) => rule.includes(`"action": "affinity_${tool}"`) && /"effect"\s*:\s*"allow"/.test(rule))
        const generated = file === "README.md" && source.includes(`{ "action": "affinity_${tool}", "resource": "*", "effect": "allow" }`)
        expect({ file, tool, allowed: allowed.length, generated }).toEqual({ file, tool, allowed: generated ? 1 : 0, generated })
      }
    }
  })

  test.each(FILES)("%s puts no ask or allow recipe for a Affinity tool at the top level, where it would reach Explore", (file) => {
    const raw = readFileSync(join(ROOT, file), "utf8")
    // Every JSON example that is a config: its top-level permissions only tighten.
    for (const [, body] of raw.matchAll(/```json\n([^]*?)```/g)) {
      let config: unknown
      try {
        config = JSON.parse(body!)
      } catch {
        continue
      }
      const top = !Array.isArray(config) && typeof config === "object" && config !== null ? ((config as { permissions?: { action: string; effect: string }[] }).permissions ?? []) : []
      expect(top.filter((rule) => rule.action.startsWith("affinity_") && rule.effect !== "deny")).toEqual([])
    }
    // Every ask or allow rule for one tool sits in an agent's own rules, said in its paragraph or code block. The
    // plugin's own block, which the plugin inserts itself, is the one exception.
    const blocks = raw.split(/\n\s*\n/)
    blocks.forEach((block, index) => {
      if (!/\{ "action": "affinity_[a-z_]+", "resource": "\*", "effect": "(?:ask|allow)" \}/.test(block)) return
      const context = `${blocks[index - 1] ?? ""}\n${block}`
      if (/The plugin adds these\s+rules/.test(context)) return
      // "in your permissions or an agent's own" offers the top level too: it fails.
      const agentLevel = /agent's own|"agents"/.test(context) && !/\b(?:in|to) (?:your|the same) `permissions`|here or in an agent's own/.test(context.replace(/\s+/g, " "))
      expect({ file, block: block.slice(0, 120), agentLevel }).toEqual({ file, block: block.slice(0, 120), agentLevel: true })
    })
  })

  test("the strict-agent recipe repeats every deny after its affinity_* ask, so no denied tool reopens", () => {
    const recipe = text("docs/configuration.md").split("A strict agent where every Affinity tool asks")[1]?.split("```")[1] ?? ""
    const ask = recipe.indexOf('{ "action": "affinity_*", "resource": "*", "effect": "ask" }')
    expect(ask).toBeGreaterThanOrEqual(0)
    for (const name of DESTRUCTIVE_TOOLS) expect(recipe.indexOf(`{ "action": "affinity_${name}", "resource": "*", "effect": "deny" }`)).toBeGreaterThan(ask)
  })

  test("the docs show the user's own entry with an API key from the environment, never a key itself", () => {
    const guide = text("docs/configuration.md")
    expect(guide).toContain('"headers": { "Authorization": "Bearer {env:AFFINITY_API_KEY}" }')
    expect(guide).toContain('"oauth": false')
    for (const file of FILES) expect(text(file)).not.toMatch(/Bearer (?!\{env:)[A-Za-z0-9_-]{8,}/)
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout affinity` finds no server: sign out first.
  test("the README's Uninstall signs out before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/.exec(text("README.md"))?.[1] ?? ""
    const logout = uninstall.indexOf("opencode mcp logout affinity")
    const list = uninstall.indexOf("opencode auth list")
    const remove = uninstall.indexOf("opencode plugin remove @joe-broadhead/opencode-affinity")
    expect(logout).toBeGreaterThanOrEqual(0)
    expect(list).toBeGreaterThan(logout)
    expect(remove).toBeGreaterThan(list)
  })

  // Every code the plugin's own code raises (the tools RPC's are in docs/scripting.md) has no service prefix and a row
  // in the configuration guide's Errors table.
  test("DR-6 to DR-8: the sign-in and sign-out commands carry the project-folder and cold-start caveat", () => {
    const caveat = "Run it from the project folder where the plugin is installed, or remove the account in `/connect` → **Affinity**. If it answers `MCP server not found: affinity`, OpenCode is still opening that folder: wait a few seconds and run it again."
    for (const file of ["README.md", "docs/configuration.md"]) expect({ file, caveat: text(file).includes(caveat) }).toEqual({ file, caveat: true })
    expect(text("skills/affinity/SKILL.md")).toContain("from the project folder where the plugin is installed; if it says `MCP server not found`, wait a few seconds and run it again")
    // And each troubleshooting row that names a command points back to it.
    const troubleshooting = /## Troubleshooting(.*?)## /.exec(text("README.md"))?.[1] ?? ""
    for (const row of troubleshooting.split("| Connection: sign-in required").slice(1)) expect(row).toContain("from the project folder")
  })

  test("the admin step is advice beside the status, not an error code: it is in no error list, and both guides keep it", () => {
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const troubleshooting = /## Troubleshooting(.*?)## /.exec(text("README.md"))?.[1] ?? ""
    expect(errors).not.toContain("CLIENT_NOT_ALLOWED")
    for (const file of FILES) expect(text(file)).not.toContain("CLIENT_NOT_ALLOWED")
    expect(troubleshooting).toContain("| Organisation setup row: Affinity shows an error page instead of asking for access |")
    expect(troubleshooting).toContain("https://opencode.ai/oauth/opencode/client.json")
    expect(text("docs/configuration.md")).toContain("https://opencode.ai/oauth/opencode/client.json")
    // It is worded for a first sign-in, because status cannot tell a refusal from an expiry.
    expect(text("docs/configuration.md")).toContain("If this is the first sign-in here, an Affinity admin must first add OpenCode's client URL")
    expect(text("README.md")).toContain("A sign-in that worked before and now needs one again is an expiry")
  })

  test("the guides state what happens, and claim no unverified or simulated flow", () => {
    // DR-2: the sign-in is the section where a stranger decides to try the plugin, so it says what happens and stops.
    // The tool table's reconcile note is the one live-sign-in sentence the README may keep, in Known limits.
    for (const file of FILES) {
      expect({ file, claim: /simulated|reproduced only against|known only from|first live sign-in confirms|confirmed at the first live sign-in|is still unverified|not yet verified/i.exec(text(file))?.[0] }).toEqual({ file, claim: undefined })
    }
    expect(text("README.md")).toContain("If Affinity shows an error page instead of the consent screen, your organisation has not added OpenCode yet")
    expect(text("docs/configuration.md")).toContain("After a sign-in that worked, a later one is a renewal, and the row says so instead")
  })

  test("the guides name Affinity CRM apart from Canva's design apps, and document the playbook commands", () => {
    const readme = text("README.md")
    expect(readme).toContain("This is Affinity CRM ([affinity.co](https://www.affinity.co)), the relationship-intelligence CRM for deal teams: not Affinity Photo, Designer or Publisher, Canva's design apps")
    for (const guide of [readme, text("docs/configuration.md")]) {
      expect(guide).toContain("/affinity:<name>")
      expect(guide).toContain("A run is your request for that routine; the text it adds is Affinity's, so its steps are guidance")
      expect(guide).toContain("/affinity:affinity-meeting-prep")
    }
    expect(text("SECURITY.md")).toContain("a run is your request for that routine, but the text it adds is Affinity's")
  })

  test("the guides name the scope to untick, not its position on the consent screen", () => {
    for (const file of ["README.md", "docs/configuration.md", "SECURITY.md", "skills/affinity/SKILL.md"]) {
      expect(text(file)).toMatch(/untick(?:ing)? `mcp`|with `mcp` \(changes\) unticked/i)
      expect(text(file)).not.toMatch(/untick the first scope|Unticking the first scope/)
    }
    expect(text("README.md")).toContain("keep `offline_access`")
  })

  test("the own-OAuth-app recipe states the loopback redirect OpenCode sends", () => {
    const guide = text("docs/configuration.md")
    expect(guide).toContain("Affinity accepts a loopback redirect URI on any port, and OpenCode sends the port it listens on")
    expect(guide).toContain("sends `http://127.0.0.1:<port>/callback` as the redirect")
    expect(text("docs/architecture.md")).toContain("The fake advertises more than the pin, and the DR-1 host cases fail if the pin is removed")
  })

  test("the scripting guide qualifies what a script's rules are, across locations", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("the rules of that location's agents, not of a session created in another project")
    expect(guide).toContain("A session created in another directory does not carry its own location's rules")
    expect(guide).not.toMatch(/exactly the\s+access its model would have/)
  })

  test("every code raised in src/ is in CODES, and every non-rpc code in CODES is raised", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts")).map((name) => [name, readFileSync(join(ROOT, "src", name), "utf8")] as const)
    const found = new Set(sources.flatMap(([, source]) => [...source.matchAll(/(?:affinityError|errorText|codeText)\(\s*"([A-Z][A-Z_]+)"/g)].map((match) => match[1]!)))
    for (const [, source] of sources) for (const match of source.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+): /g)) found.add(match[1]!)
    expect([...found].filter((code) => !(code in CODES))).toEqual([])
    const declared = Object.entries(CODES).filter(([, entry]) => entry.surface !== "rpc").map(([code]) => code)
    expect(declared.filter((code) => !found.has(code))).toEqual([])
  })

  test("the tools RPC's next steps are exactly the rpc codes in CODES", () => {
    const rpc = Object.entries(CODES).filter(([, entry]) => entry.surface === "rpc").map(([code]) => code)
    expect(Object.keys(NEXT_STEPS).sort()).toEqual(rpc.sort())
  })

  test("the README's Errors table is CODES, in both directions, with the same surface and when", () => {
    const errors = /## Errors\n([\s\S]*?)\n## /.exec(raw("README.md"))?.[1] ?? ""
    const rows = [...errors.matchAll(/\| `([A-Z][A-Z_]+)` \| ([a-z-]+) \| ([^|]+?) \|/g)].map(([, code, surface, when]) => [code!, { surface: surface!, when: when!.trim() }] as const)
    expect(Object.fromEntries(rows)).toEqual(CODES)
  })

  test("the configuration guide documents the setup and status codes, and the scripting guide the rpc ones", () => {
    const errors = /## Errors([\s\S]*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const setup = Object.entries(CODES).filter(([, entry]) => entry.surface !== "rpc").map(([code]) => code)
    expect([...errors.matchAll(/\| `([A-Z][A-Z_]+)` \|/g)].map((match) => match[1]!).sort()).toEqual(setup.sort())
    const scripting = /## Errors([\s\S]*?)## What scripts cannot do/.exec(text("docs/scripting.md"))?.[1] ?? ""
    for (const [code, entry] of Object.entries(CODES)) expect({ code, named: entry.surface !== "rpc" || scripting.includes(`\`${code}\``) }).toEqual({ code, named: true })
    const named = [...scripting.matchAll(/`([A-Z][A-Z_]+)`/g)].map((match) => match[1]!)
    expect(named.filter((code) => !(code in CODES))).toEqual([])
  })


  test("the configuration guide's Errors table lists only codes the plugin raises", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts") && name !== "tools-rpc.ts")
    const raised = sources.map((name) => readFileSync(join(ROOT, "src", name), "utf8")).join("\n")
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const documented = [...errors.matchAll(/\| `([A-Z][A-Z_]+)` \|/g)].map((match) => match[1]!)
    expect(documented.length).toBeGreaterThan(5)
    expect(documented.filter((code) => !raised.includes(`"${code}"`) && !raised.includes(`${code}:`) && !raised.includes(`(${code})`))).toEqual([])
  })

  // R8: every "tested on ..." mention is TESTED_HOSTS, and the untested example is a version that is not a release.
  test("every tested-on mention equals TESTED_HOSTS, and the untested example is not a tested release", () => {
    let mentions = 0
    const check = (file: string, source: string) => {
      for (const match of source.matchAll(/tested on /g)) {
        mentions += 1
        const run = /^\s*((?:\d+\.\d+\.\d+)(?:(?:,[ \t]*|\s+and\s+)(?:\d+\.\d+\.\d+))*)/.exec(source.slice(match.index! + match[0].length))?.[1] ?? ""
        expect({ file, versions: [...(run.match(/\d+\.\d+\.\d+/g) ?? [])] }).toEqual({ file, versions: [...TESTED_HOSTS] })
      }
    }
    for (const file of ["README.md", "AGENTS.md", "SECURITY.md", "docs/configuration.md"]) check(file, raw(file))
    // The release heading is `## [0.0.0] - <date>` once the release kit has dated it; before that, `- Unreleased`.
    const changelog = /## \[[\s\S]*?\] - (?:Unreleased|\d{4}-\d{2}-\d{2})\n([\s\S]*?)(?:\n## \[|$)/.exec(raw("CHANGELOG.md"))?.[1] ?? ""
    expect(changelog.length).toBeGreaterThan(0)
    check("CHANGELOG.md (Unreleased)", changelog)
    expect(mentions).toBeGreaterThanOrEqual(2)
    const list = `${TESTED_HOSTS.slice(0, -1).join(", ")} and ${TESTED_HOSTS.at(-1)}`
    for (const file of ["AGENTS.md", "docs/configuration.md", "CONTRIBUTING.md"]) expect({ file, list: text(file).includes(list) }).toEqual({ file, list: true })
    expect(text("docs/configuration.md")).toContain(UNTESTED_EXAMPLE)
    for (const version of TESTED_HOSTS) expect(text("docs/configuration.md")).not.toContain(`inside the range, such as ${version}`)
  })

  // R9: shipped text states behaviour, never who decided it, and names no lane.
  test("the shipped docs use no internal wording", () => {
    const banned = /\bowner(?:'s)? (?:decision|ruling|sign-off|call)\b|\bthe lead(?:'s)? (?:decision|ruling|audit|report|review)\b|\bhey-jelly\s*#|\b(?:audit|review|reconcile) lane\s+[A-Z]\d\b|\blane\s+G\d\b/i
    for (const file of FILES) expect({ file, hit: banned.exec(text(file))?.[0] }).toEqual({ file, hit: undefined })
  })

  // R1: every example runs the RPC this plugin registers, with the location header and the envelope, and names a method
  // in the table.
  test("every scripting example has the RPC id, the location header, the envelope, and a method in the table", () => {
    const names = new Set(["describe", ...METHODS.map((method) => method.name)])
    let examples = 0
    for (const file of ["docs/scripting.md", "README.md"]) {
      const source = raw(file).replace(/\\\n\s*/g, " ")
      for (const match of source.matchAll(/opencode api post (\/api\/rpc\/[^\s/]+\/([A-Za-z0-9._<>-]+))[ \t]+([^\n]*)/g)) {
        examples += 1
        const [, path, method] = match
        const placeholder = method!.startsWith("<")
        expect({ file, path }).toEqual({ file, path: `/api/rpc/${TOOLS_RPC_ID}/${method}` })
        if (!placeholder) expect({ file, method, known: names.has(method!) }).toEqual({ file, method, known: true })
        expect({ file, header: match[0].includes(`-H "x-opencode-directory:$PWD"`) }).toEqual({ file, header: true })
        if (placeholder) continue
        const window = source.slice(match.index!, match.index! + match[0].length + 400).replace(/\n\s+(?=["}])/g, "")
        const body = /-d '(\{[^']*\})'/.exec(window)
        expect({ file, body: body !== null }).toEqual({ file, body: true })
        const parsed = JSON.parse(body![1]!) as { input?: { sessionID?: unknown; input?: unknown } }
        expect({ file, envelope: typeof parsed.input }).toEqual({ file, envelope: "object" })
        const session = typeof parsed.input!.sessionID
        if (method === "describe") {
          expect({ file, session: session === "string" || session === "undefined" }).toEqual({ file, session: true })
          expect({ file, keys: Object.keys(parsed.input!).filter((key) => key !== "sessionID") }).toEqual({ file, keys: [] })
          continue
        }
        expect({ file, session }).toEqual({ file, session: "string" })
        expect({ file, input: typeof parsed.input!.input }).toEqual({ file, input: "object" })
        const recorded = PARAMETERS[method!]
        if (recorded) {
          const keys = Object.keys(parsed.input!.input as Record<string, unknown>)
          const known = recorded.map((entry) => entry.split(":")[0]!.replace(/\*$/, ""))
          expect({ file, method, unknown: keys.filter((key) => !known.includes(key)) }).toEqual({ file, method, unknown: [] })
          expect({ file, method, missing: known.filter((name) => recorded.some((entry) => entry.startsWith(`${name}*:`)) && !keys.includes(name)) }).toEqual({ file, method, missing: [] })
        }
      }
    }
    expect(examples).toBeGreaterThanOrEqual(3)
  })

  test("the Jelly guide describes the declaration as Jelly reads it, with no placeholder or version", () => {
    const guide = text("docs/jelly.md")
    expect(guide).not.toMatch(/`latest` is|None yet/)
    expect(guide).toContain("the one line in `jelly.summary`, and beside it the mark in `jelly.icon`")
    // Jelly's contracts drop an unknown top-level key; they do not refuse the declaration for it.
    expect(guide).toContain("drop a top-level key they don't know")
    expect(guide).not.toMatch(/refuses this declaration|accepts no unknown keys/)
    // R18: a tool Affinity adds later is undeclared, so Jelly runs it with the plugin's own default.
    expect(guide).toContain("in Jelly it runs with the plugin's own default: allowed, even if it changes something")
    const destructive = guide.split("- The seven deletes")[1]?.split("A tool the upstream server adds later")[0] ?? ""
    for (const name of DESTRUCTIVE_TOOLS) expect(destructive).toContain(`affinity_${name}`)
    const skills = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).jelly.skills as string[]
    expect(guide).toContain(`Declared: ${skills.map((name) => `\`${name}\``).join(", ")}.`)
  })

  test("the scripting guide points at the known reads, and says every call counts against the firm's quota", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("(`READ_TOOLS` in `src/affinity-tools.ts`)")
    expect(guide).toContain("counts against your organisation's monthly Affinity API quota")
    expect(guide).not.toContain("rationale")
  })


  test("the README states the shared quota, the admin step and the read-only consent", () => {
    const readme = text("README.md")
    expect(readme).toContain("Every call counts against your organisation's monthly Affinity API quota, which the whole firm shares")
    expect(readme).toContain("Settings → Manage Apps → New App → **Client URL**")
    expect(readme).toContain("**Untick `mcp` (changes) for a read-only connection**")
    expect(readme).toContain("Unofficial; not affiliated with Affinity.")
  })
})
