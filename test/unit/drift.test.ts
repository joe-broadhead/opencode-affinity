// The drift script against saved tool lists: the recorded list (the research form), OpenCode's form built from it, and
// edited copies. It reads files only.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DENIED_TOOLS, PARAMETERS, READ_TOOLS, WORKFLOW_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"

const SCRIPT = fileURLToPath(new URL("../../scripts/check-affinity-tools.mjs", import.meta.url))
const FIXTURE = fileURLToPath(new URL("./affinity-tools-list.json", import.meta.url))
const dir = mkdtempSync(join(tmpdir(), "affinity-drift-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

type Research = { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean }; inputs: string[] }
const recorded = () => (JSON.parse(readFileSync(FIXTURE, "utf8")) as { tools: Research[] }).tools
const ALL = [...READ_TOOLS, ...WRITE_TOOLS, ...DENIED_TOOLS]

/** A recorded `name*:type` as a JSON Schema property; an untyped entry gets an object, as Affinity's models do. */
function property(entry: string) {
  const type = entry.split(":")[1]
  if (!type) return { $ref: "#/$defs/Model" }
  const one = (part: string): Record<string, unknown> => {
    const array = /^array<(.*)>$/.exec(part)
    return array ? { type: "array", items: one(array[1]!) } : { type: part }
  }
  const parts = type.split("|")
  return parts.length > 1 ? { anyOf: parts.map(one) } : one(type)
}

/** The same list in OpenCode's form: `id` with the server prefix, the name without it, and JSON Schemas. */
const opencodeForm = () =>
  recorded().map((tool) => ({
    id: `affinity_${tool.name}`,
    name: tool.name,
    description: `Affinity ${tool.name}`,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(tool.inputs.map((entry) => [entry.split(":")[0]!.replace(/\*$/, ""), property(entry)])),
      required: tool.inputs.filter((entry) => entry.split(":")[0]!.endsWith("*")).map((entry) => entry.split(":")[0]!.slice(0, -1)),
    },
  }))

let files = 0
function drift(list: unknown, ...args: string[]) {
  const file = join(dir, `tools-${++files}.json`)
  writeFileSync(file, JSON.stringify(list))
  const result = spawnSync("node", [SCRIPT, file, ...args], { encoding: "utf8" })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

describe("npm run drift", () => {
  test("PARAMETERS records every known tool", () => {
    expect(Object.keys(PARAMETERS).sort()).toEqual([...ALL].sort())
  })

  test("the recorded list matches the tool lists and PARAMETERS exactly, and its annotations match each class", () => {
    const tools = recorded()
    expect(tools.map((tool) => tool.name).sort()).toEqual([...ALL].sort())
    for (const tool of tools) {
      expect({ name: tool.name, inputs: tool.inputs }).toEqual({ name: tool.name, inputs: [...PARAMETERS[tool.name]!] })
      expect({ name: tool.name, readOnly: tool.annotations.readOnlyHint }).toEqual({ name: tool.name, readOnly: READ_TOOLS.includes(tool.name) })
    }
    const { code, out } = drift({ tools }, "--strict")
    expect([code, out.trim().split("\n").at(-1)]).toEqual([0, "No drift."])
    expect(out).toContain("The list holds 82 tools: 52 read, 20 write, 10 denied, 0 unclassified.")
  })

  test("OpenCode's form of the same list shows no drift, and a playbook keeps its own affinity_ name", () => {
    const { code, out } = drift({ tools: opencodeForm() }, "--strict")
    expect([code, out.trim().split("\n").at(-1)]).toEqual([0, "No drift."])
    expect(WORKFLOW_TOOLS).toContain("affinity_meeting_prep")
  })

  test("reports added, removed, renamed and changed parameters; a removed tool is drift, because everyone gets one list", () => {
    const tools = opencodeForm().filter((tool) => tool.name !== "get_list_info")
    const notes = tools.find((tool) => tool.name === "search_notes")!
    notes.name = "semantic_note_search"
    notes.id = "affinity_semantic_note_search"
    const people = tools.find((tool) => tool.name === "search_persons")!
    delete (people.inputSchema.properties as Record<string, unknown>).total_count
    people.inputSchema.properties.window = { type: "object" }
    people.inputSchema.properties.limit = { type: "string" }
    people.inputSchema.required = [...people.inputSchema.required, "window"]
    const { code, out } = drift({ tools }, "--strict")
    expect(code).toBe(1)
    expect(out).toContain("Added: listed by Affinity, in no list of src/affinity-tools.ts:\n  semantic_note_search")
    expect(out).toContain("Removed: in src/affinity-tools.ts, not in this list (Affinity lists the same tools to everyone, so a release removed them):")
    expect(out).toContain("  get_list_info")
    expect(out).toContain("Possibly renamed: a removed tool and an added one take mostly the same parameters:\n  search_notes -> semantic_note_search")
    expect(out).toContain("  search_persons: +window*:object -total_count limit (integer -> string)")
    // A removed tool alone fails --strict too.
    expect(drift({ tools: opencodeForm().filter((tool) => tool.name !== "get_list_info") }, "--strict").code).toBe(1)
  })

  test("a type the record lacks is reported, so reconciling fills it in", () => {
    const tools = opencodeForm()
    const people = tools.find((tool) => tool.name === "search_persons")!
    people.inputSchema.properties.search_criteria = { anyOf: [{ type: "object" }, { type: "null" }] }
    const { code, out } = drift({ tools }, "--strict")
    expect(code).toBe(1)
    expect(out).toContain("  search_persons: search_criteria (type not recorded -> object|null)")
  })

  test("a read whose description says it changes or sends something is flagged; nouns, enums and other tools are not", () => {
    const describe = (name: string, description: string) => ({ ...opencodeForm().find((tool) => tool.name === name)!, description })
    const quiet = [
      describe("get_notes_for_entity", "Get a page of notes. For the reverse, use get_entities_attached_to_note."),
      describe("get_reminders", "- TYPE: ONE_TIME / RECURRING; filter by COMPANY or PERSON."),
      describe("affinity_meeting_prep", "Read-only: never writes. Call create_note only on explicit confirmation."),
      describe("get_lists", "1. Create a list (create_list) when the user asks for one."),
    ]
    const loud = [
      describe("get_users", "Sends an invitation email to every listed user."),
      describe("search_opportunities", "<usecase>This tool creates an opportunity from the search.</usecase>"),
    ]
    const others = opencodeForm().filter((tool) => ![...quiet, ...loud].some((item) => item.name === tool.name))
    const { out } = drift({ tools: [...others, ...quiet, ...loud] })
    expect(out).toContain("  get_users  (Sends)")
    expect(out).toContain("  search_opportunities  (creates)")
    for (const tool of quiet) expect(out).not.toContain(`  ${tool.name}  (`)
  })

  test("a list with annotations shows a read that became a write; OpenCode's form says it can't check that", () => {
    const tools = recorded()
    tools.find((tool) => tool.name === "get_person_info")!.annotations = { readOnlyHint: false, destructiveHint: false }
    const { code, out } = drift({ tools })
    expect(code).toBe(0)
    expect(out).toContain("Reclassified: the lists disagree with Affinity's annotations:\n  get_person_info  readOnlyHint=false destructiveHint=false")
    expect(drift({ tools: opencodeForm() }).out).toContain("Not checked: this list carries no annotations")
  })

  test("refuses a file that is not a tool list, and a missing argument, with exit code 2", () => {
    expect(drift({ servers: [] }).code).toBe(2)
    const none = spawnSync("node", [SCRIPT], { encoding: "utf8" })
    expect(none.status).toBe(2)
    expect(none.stderr).toContain("no tool list given")
  })
})
