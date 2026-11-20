// package.json's `sources` against the code that serves it, and the source contract's conformance kit over it, as
// `npm run conformance` runs it for a release.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { declarationProblems } from "@we-the-rebel-alliance/source-contract/conformance"
import { EVENTS_LIST, PROBE } from "@we-the-rebel-alliance/source-contract/events"
import { COMPANIES_ID, COMPANIES_LIST } from "../../src/companies.js"
import { COST_UNIT, EVENTS_ACTION, MAX_BYTES, PACKAGE, PROBE_ACTION, SOURCE, SOURCE_ID } from "../../src/events.js"
import { SOURCE_METHODS } from "../../src/permissions.js"
import { TOOLS_RPC_ID } from "../../src/tools-rpc.js"
import { ROOT, conformanceReports, declaredSources, declaredTools, installed } from "../support/conformance.js"

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { name: string; sources: Record<string, unknown> }

describe("the sources declaration", () => {
  test("validates as a consumer reads it from the installed package, and as the kit reads it", () => {
    expect(installed().hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(declarationProblems(pkg.sources, { tools: declaredTools() })).toEqual([])
    expect(pkg.name).toBe(PACKAGE)
  })

  test("names the code's own ids, actions and limits: affinity.meetings, and the list snapshot affinity.companies", () => {
    const sources = declaredSources()
    expect(sources.rpc).toBe(TOOLS_RPC_ID)
    expect(sources.probe).toEqual({ action: PROBE_ACTION })
    expect(sources.items.map((item) => item.id)).toEqual([SOURCE_ID, COMPANIES_ID])
    const item = sources.items[0]!
    expect(item).toMatchObject({ id: SOURCE_ID, kind: "events", reads: "meeting", tool: EVENTS_LIST, input: { source: SOURCE }, private: true, maxBytes: MAX_BYTES })
    // Every listing names its account, as probe answers it.
    expect(item.accounts).toEqual({ named: true })
    // Exactly what the reads call, with the identity read the probe makes.
    expect(item.permission).toEqual({ events: EVENTS_ACTION, operations: ["get_current_user", "get_meetings"], identity: ["get_current_user"] })
    // Each Affinity call counts against the firm's quota; no price, and no key a 0.1 consumer refuses.
    expect(item.cost).toEqual({ class: "metered", units: [{ per: COST_UNIT, usd: 0 }], probe: { per: COST_UNIT, usd: 0 } })
    expect(SOURCE_METHODS).toEqual([EVENTS_LIST, PROBE])
    const companies = sources.items[1]!
    expect(companies).toMatchObject({
      id: COMPANIES_ID,
      kind: "snapshot",
      output: "list",
      tool: EVENTS_LIST,
      input: { source: SOURCE, list: COMPANIES_LIST },
      private: true,
      maxBytes: MAX_BYTES,
      maxAgeSec: 900,
    })
    expect(companies.accounts).toEqual({ named: true })
    expect(companies.permission).toEqual({ tool: EVENTS_ACTION, operations: ["get_current_user", "search_all_companies"], identity: ["get_current_user"] })
    expect(companies.cost).toEqual(item.cost)
  })

  test("declares none of the keys a consumer on source-contract 0.1 refuses", () => {
    const text = JSON.stringify(pkg.sources)
    for (const key of ["identityRules", "readsIdentity", "\"server\"", "\"conditions\"", "\"min\"", "\"verified\""]) expect({ key, found: text.includes(key) }).toEqual({ key, found: false })
  })
})

describe("the source contract's conformance kit", () => {
  test("affinity.meetings keeps the contract: every check that applies ran, and none found a problem", async () => {
    const reports = await conformanceReports()
    expect(reports.map((report) => report.source)).toEqual([SOURCE_ID, COMPANIES_ID])
    const report = reports.find((entry) => entry.source === SOURCE_ID)
    expect(report!.problems).toEqual([])
    expect(report!.incomplete).toBe(false)
    expect(report!.ok).toBe(true)
    const ran = report!.checks.filter((check) => check.ran).map((check) => check.name)
    for (const name of ["declaration", "page-result", "gap-and-cursor-expired", "gap-once-per-read", "refused-is-final", "identity-grants", "probe", "rpc-id", "unused-grants"]) expect(ran).toContain(name)
    // Stated, not skipped: why no meeting can fail alone. History can be lost (deleted meetings), so the gap check runs.
    const stated = Object.fromEntries(report!.checks.filter((check) => check.reason !== undefined).map((check) => [check.name, check.notApplicable]))
    expect(stated).toEqual({ "failed-holds-cursor": true })
    const listed = reports.find((entry) => entry.source === COMPANIES_ID)
    expect(listed!.problems).toEqual([])
    expect(listed!.incomplete).toBe(false)
    expect(listed!.ok).toBe(true)
  })
})
