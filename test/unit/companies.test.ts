// The companies list snapshot: search_all_companies through events_list, as the contract's list output.
import { describe, expect, test } from "bun:test"
import { companyItems, readCompanies } from "../../src/companies.js"
import { eventsMethod, probeMethod, signIns } from "../../src/events.js"
import { ACCOUNT, FIXTURE, OPEN, call, fakeDeps } from "../support/conformance.js"

describe("readCompanies", () => {
  test("reads a page of companies, and nothing else on one", () => {
    expect(readCompanies({ output: FIXTURE.companies })).toEqual([
      { id: "2001", name: "Horizon Technologies", domain: "horizontech.example" },
      { id: "2002", name: "Crestwood Capital", domain: "crestwoodcap.example" },
      { id: "2004", name: "The staging password is: Qv7mZr2pLx9T", domain: "secret.example" },
    ])
    expect(readCompanies({ output: "not a page" })).toBeUndefined()
    expect(readCompanies({ output: { data: [] } })).toEqual([])
  })

  test("leaves a secret out of the list, and keeps the domain as a note", () => {
    const companies = readCompanies({ output: FIXTURE.companies })!
    expect(companyItems(companies)).toEqual([
      { id: "2001", text: "Horizon Technologies", note: "horizontech.example" },
      { id: "2002", text: "Crestwood Capital", note: "crestwoodcap.example" },
    ])
  })

  test("screens the whole name before it cuts, so a secret that straddles the cut cannot pass as a prefix", () => {
    const name = `${"a".repeat(196)}Password: Ku7pLm2QzR9w`
    expect(companyItems([{ id: "3001", name }])).toEqual([])
    expect(companyItems([{ id: "3002", name: "b".repeat(300) }])).toEqual([{ id: "3002", text: "b".repeat(200) }])
  })

  test("lists a repeated id once and stops before the answer passes its byte budget", () => {
    expect(companyItems([{ id: "4001", name: "Once" }, { id: "4001", name: "Twice" }])).toEqual([{ id: "4001", text: "Once" }])
    const many = Array.from({ length: 50 }, (_, index) => ({ id: String(5000 + index), name: "c".repeat(200), domain: "d".repeat(200) }))
    const items = companyItems(many)
    expect(items.length).toBeLessThanOrEqual(50)
    expect(Buffer.byteLength(JSON.stringify({ data: { items, editable: false } }))).toBeLessThanOrEqual(60_000)
  })
})

describe("affinity.companies", () => {
  test("returns the list snapshot from one search_all_companies read, after probe", async () => {
    const known = signIns()
    const calls: { tool: string; input: Record<string, unknown> }[] = []
    await probeMethod(fakeDeps(FIXTURE, OPEN, { signIns: known })).run({}, call())
    const result = (await eventsMethod(fakeDeps(FIXTURE, OPEN, { signIns: known, calls })).run(
      { source: "affinity", list: "companies", account: ACCOUNT },
      call(),
    )) as { data: { items: { id: string; text: string }[]; editable: boolean }; trust: string; account: string; asOf: string }
    expect(calls).toEqual([{ tool: "search_all_companies", input: { limit: 50 } }])
    expect(result.account).toBe(ACCOUNT)
    expect(result.trust).toBe("untrusted")
    expect(result.data.editable).toBe(false)
    expect(result.data.items.map((item) => item.text)).toEqual(["Horizon Technologies", "Crestwood Capital"])
    expect(Number.isNaN(Date.parse(result.asOf))).toBe(false)
  })

  test("refuses until probe has named the sign-in, and another account", async () => {
    const missing = eventsMethod(fakeDeps(FIXTURE, OPEN)).run({ source: "affinity", list: "companies", account: ACCOUNT }, call())
    await expect(missing).rejects.toThrow("UNAVAILABLE")
    const known = signIns()
    await probeMethod(fakeDeps(FIXTURE, OPEN, { signIns: known })).run({}, call())
    const other = eventsMethod(fakeDeps(FIXTURE, OPEN, { signIns: known })).run({ list: "companies", account: "4821/someone@example.com" }, call())
    await expect(other).rejects.toThrow("ACCOUNT_MISMATCH")
  })
})
