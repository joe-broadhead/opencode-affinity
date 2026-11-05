// The tool lists in src/affinity-tools.ts are the one record of Affinity's tools; everything else derives from them.
import { describe, expect, test } from "bun:test"
import { classify, DENIED_TOOLS, PARAMETERS, READ_TOOLS, WORKFLOW_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"

const ALL = [...READ_TOOLS, ...WRITE_TOOLS, ...DENIED_TOOLS]

describe("Affinity's tool lists", () => {
  test("name each tool once, in one list only, as a plain lower-case name without the server prefix", () => {
    expect(new Set(ALL).size).toBe(ALL.length)
    for (const name of ALL) expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
    // A playbook's own name may start with affinity_; the server prefix is never part of a name.
    expect(ALL.filter((name) => name.startsWith("affinity_") && !WORKFLOW_TOOLS.includes(name))).toEqual([])
  })

  test("52 reads, of them 12 workflow playbooks; 20 writes; 10 denied", () => {
    expect([READ_TOOLS.length, WORKFLOW_TOOLS.length, WRITE_TOOLS.length, DENIED_TOOLS.length]).toEqual([52, 12, 20, 10])
    for (const tool of WORKFLOW_TOOLS) expect(READ_TOOLS).toContain(tool)
    // A playbook takes one optional file, and returns text.
    for (const tool of WORKFLOW_TOOLS) expect(PARAMETERS[tool]).toEqual(["file:string|null"])
  })

  test("classify each tool by its list, and everything else as unknown", () => {
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of WRITE_TOOLS) expect(classify(tool)).toBe("write")
    for (const tool of DENIED_TOOLS) expect(classify(tool)).toBe("denied")
    for (const tool of ["shiny_new_tool", "", "affinity_search_persons", "SEARCH_PERSONS", "describe"]) expect(classify(tool)).toBe("unknown")
  })

  test("reads never change anything: no create, send, update or other change verb is a read", () => {
    const change = /^(create|send|update|upsert|issue|delete|merge)_/
    expect(READ_TOOLS.filter((tool) => change.test(tool))).toEqual([])
    expect(WRITE_TOOLS.filter((tool) => !change.test(tool))).toEqual([])
  })

  test("the account read is a known read; every delete, every merge and feedback to Affinity are denied", () => {
    expect(READ_TOOLS).toContain("get_current_user")
    expect(ALL.filter((tool) => /^(delete|merge)_/.test(tool) || tool === "send_feedback").sort()).toEqual([...DENIED_TOOLS].sort())
    expect(DENIED_TOOLS).toHaveLength(10)
  })
})
