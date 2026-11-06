// The docs and skills must match the code: tool names, the deny rule, error codes, the uninstall order and the Jelly
// guide. They state no tool counts, so a change to src/affinity-tools.ts cannot leave a stale number behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DENIED_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"

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
const KNOWN = [...READ_TOOLS, ...WRITE_TOOLS, ...DENIED_TOOLS]
const text = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ")
const DENY_RULE = '{ "action": "affinity_send_feedback", "resource": "*", "effect": "deny" }'
const OPT_IN = '{ "action": "affinity_send_feedback", "resource": "*", "effect": "ask" }'

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

  test("the README names no version of the plugin, not even in an example", () => {
    expect(text("README.md")).not.toMatch(/opencode-affinity@\d|\b0\.\d+\.\d+\b|\bv\d+\.\d+\.\d+\b/)
  })

  test("the README and the configuration guide give each denied tool its deny rule, and the guide the ask rule that turns it on", () => {
    const rule = (name: string, effect: string) => `{ "action": "affinity_${name}", "resource": "*", "effect": "${effect}" }`
    for (const name of DENIED_TOOLS) {
      for (const file of ["README.md", "docs/configuration.md"]) expect(text(file)).toContain(rule(name, "deny"))
      expect(text("docs/configuration.md")).toContain(rule(name, "ask"))
      // The opt-in is a per-call ask, never an allow.
      for (const file of FILES) expect(text(file)).not.toContain(rule(name, "allow"))
    }
    expect(text("docs/configuration.md")).toContain(DENY_RULE)
    expect(text("docs/configuration.md")).toContain(OPT_IN)
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
    for (const name of DENIED_TOOLS) expect(recipe.indexOf(`{ "action": "affinity_${name}", "resource": "*", "effect": "deny" }`)).toBeGreaterThan(ask)
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

  test("the configuration guide documents every error code the plugin raises, none with a service prefix", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts"))
    const codes = new Set(sources.flatMap((name) => [...readFileSync(join(ROOT, "src", name), "utf8").matchAll(/(?:affinityError|errorText)\(\s*"([A-Z][A-Z_]+)"/g)].map((match) => match[1]!)))
    expect(codes.size).toBeGreaterThan(3)
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const troubleshooting = /## Troubleshooting(.*?)## /.exec(text("README.md"))?.[1] ?? ""
    for (const code of codes) {
      expect(code).not.toStartWith("AFFINITY_")
      expect(errors).toContain(`| \`${code}\` |`)
      // Every code the plugin raises has a README troubleshooting row too.
      expect({ code, inReadme: troubleshooting.includes(`| \`${code}\` |`) }).toEqual({ code, inReadme: true })
    }
  })

  test("the configuration guide's Errors table lists only codes the plugin raises", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts") && name !== "tools-rpc.ts")
    const raised = sources.map((name) => readFileSync(join(ROOT, "src", name), "utf8")).join("\n")
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const documented = [...errors.matchAll(/\| `([A-Z][A-Z_]+)` \|/g)].map((match) => match[1]!)
    expect(documented.length).toBeGreaterThan(5)
    expect(documented.filter((code) => !raised.includes(`"${code}"`) && !raised.includes(`${code}:`) && !raised.includes(`(${code})`))).toEqual([])
  })

  test("the Jelly guide describes the declaration as Jelly reads it, with no placeholder or version", () => {
    const guide = text("docs/jelly.md")
    expect(guide).not.toMatch(/`latest` is|None yet/)
    expect(guide).toContain("the one line in `jelly.summary`, and beside it the mark in `jelly.icon`")
    // Jelly's contracts drop an unknown top-level key; they do not refuse the declaration for it.
    expect(guide).toContain("drop a top-level key they don't know")
    expect(guide).not.toMatch(/refuses this declaration|accepts no unknown keys/)
    // A tool Affinity adds later is undeclared, and Jelly runs it unasked: the guide says so plainly.
    expect(guide).toContain("in Jelly it runs without asking, even if it changes something")
    expect(guide).not.toContain("not asked about")
    const off = guide.split("- Off:")[1]?.split("- Everything else")[0] ?? ""
    for (const name of DENIED_TOOLS) expect(off).toContain(`\`affinity_${name}\``)
    const skills = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).jelly.skills as string[]
    expect(guide).toContain(`Declared: ${skills.map((name) => `\`${name}\``).join(", ")}.`)
  })

  test("the scripting guide points at the known reads, and says every call counts against the firm's quota", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("(`READ_TOOLS` in `src/affinity-tools.ts`)")
    expect(guide).toContain("counts against your organisation's monthly Affinity API quota")
    expect(guide).not.toContain("rationale")
  })

  test("DR-3 and DR-12: no doc or skill advises an allow for a write, and no recipe silences one", () => {
    // A change reaches the firm's shared CRM, so it keeps its prompt: an allow for a write hands that gate away, and an
    // unattended run has nobody to read the sentence on whom the change reaches.
    const writes = new Set([...WRITE_TOOLS, ...DENIED_TOOLS])
    for (const file of FILES) {
      const raw = readFileSync(join(ROOT, file), "utf8")
      for (const [, action] of raw.matchAll(/\{\s*"action":\s*"affinity_([a-z_]+)"[^}]*"effect":\s*"allow"/g)) {
        expect({ file, action, write: writes.has(action!) }).toEqual({ file, action, write: false })
      }
      expect({ file, prose: /allow`? rule for (?:that|a)[^.]*\bwrite/i.exec(raw)?.[0] }).toEqual({ file, prose: undefined })
    }
    const readme = text("README.md")
    expect(readme).toContain("A change needs an interactive session")
    expect(readme).not.toContain("affinity_create_note")
    expect(text("docs/configuration.md")).toContain("Answering \"Always allow\" at a prompt is the user's own choice")
    expect(text("docs/configuration.md")).toContain("a note lands in the firm's shared CRM")
    expect(text("docs/configuration.md")).toContain("No recipe here makes a change run without a prompt")
  })

  test("the README states the shared quota, the admin step and the read-only consent", () => {
    const readme = text("README.md")
    expect(readme).toContain("Every call counts against your organisation's monthly Affinity API quota, which the whole firm shares")
    expect(readme).toContain("Settings → Manage Apps → New App → **Client URL**")
    expect(readme).toContain("**Untick `mcp` (changes) for a read-only connection**")
    expect(readme).toContain("Unofficial; not affiliated with Affinity.")
  })
})
