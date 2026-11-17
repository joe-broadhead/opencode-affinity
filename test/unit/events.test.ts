// The meetings source: events_list and probe against the fake Affinity of test/support/conformance.ts (the fixture's
// invented organisation, in the shapes of Affinity's API v2), and the readers of Affinity's answers.
import { describe, expect, test } from "bun:test"
import { encodeBoundCursor, encodeCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { resultProblems, type EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import { EventsFailure, EXPIRE_DAYS, LATE_DAYS, MAX_BYTES, MAX_CALLS, PROBE_ACTION, READ_BACK_DAYS, EVENTS_ACTION, accountOf, eventsMethod, probeMethod, signIns, type SignIns } from "../../src/events.js"
import { readCurrentUser, readMeetingsPage } from "../../src/meetings.js"
import { pluginError } from "../../src/tools-rpc.js"
import { ACCOUNT, CREDENTIAL, FIXTURE, NOW, OPEN, call, fakeDeps, type FakeOptions, type Fixture } from "../support/conformance.js"

const SINCE = "2026-11-01T00:00:00Z"
const DAY = 86_400_000

/** A sign-in probe has named, as a consumer's bind leaves it. */
async function probed(fixture: Fixture = FIXTURE): Promise<SignIns> {
  const known = signIns()
  await probeMethod(fakeDeps(fixture, OPEN, { signIns: known })).run({}, call())
  return known
}

async function list(input: Record<string, unknown>, options: FakeOptions & { readonly signIns?: SignIns; readonly fixture?: Fixture } = {}): Promise<EventsListResult> {
  const fixture = options.fixture ?? FIXTURE
  const known = options.signIns ?? (await probed(fixture))
  return (await eventsMethod(fakeDeps(fixture, OPEN, { ...options, signIns: known })).run(input, call())) as EventsListResult
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof EventsFailure ? error.problem.code : String(error)
  }
}

const ids = (page: EventsListResult) => page.events.map((event) => event.external_id)

/** One of the fixture's meetings, with the signed-in user organising it, at `at`. */
const meeting = (id: number, at: string) => ({
  id,
  title: `Meeting ${id}`,
  startTime: at,
  createdAt: "2026-10-01T00:00:00Z",
  organizer: { emailAddress: "pilot.owner@example.com", person: { id: 9001, firstName: "Pilot", lastName: "Owner" } },
  attendeesPreview: { data: [], totalCount: 1 },
})

describe("probe", () => {
  test("names the account, the owner and the grant's scopes from one get_current_user call", async () => {
    const calls: FakeOptions["calls"] = []
    const known = signIns()
    const answer = await probeMethod(fakeDeps(FIXTURE, OPEN, { signIns: known, calls })).run({ source: "affinity" }, call())
    expect(answer).toEqual({
      source: "affinity",
      account: ACCOUNT,
      owner: { id: "mailto:pilot.owner@example.com", label: "Pilot Owner (Example Ventures)" },
      scopes: ["mcp", "mcp.read", "offline_access"],
      trust: "untrusted",
    })
    expect(calls.map((entry) => entry.tool)).toEqual(["get_current_user"])
    expect(known.get(CREDENTIAL)?.account).toBe(ACCOUNT)
  })

  test("refuses another account than the signed-in one, and a source it does not have", async () => {
    const deps = fakeDeps(FIXTURE, OPEN)
    expect(await code(probeMethod(deps).run({ account: "4821/someone@example.com" }, call()))).toBe("ACCOUNT_MISMATCH")
    expect(await code(probeMethod(deps).run({ account: "default" }, call()))).toBe("ACCOUNT_MISMATCH")
    expect(await code(probeMethod(deps).run({ source: "notes" }, call()))).toBe("SOURCE_UNKNOWN")
    expect(await code(probeMethod(deps).run({ extra: true }, call()))).toBe("INPUT_INVALID")
    // The same account, in another case, is the same account.
    expect(await probeMethod(deps).run({ account: "4821/Pilot.Owner@Example.com" }, call())).toMatchObject({ account: ACCOUNT })
  })

  test("an answer that names no organisation or email is UNAVAILABLE", async () => {
    const fixture = { ...FIXTURE, currentUser: { tenant: { name: "Example Ventures" }, user: {} } }
    expect(await code(probeMethod(fakeDeps(fixture, OPEN)).run({}, call()))).toBe("UNAVAILABLE")
  })

  test("asserts its own action, then get_current_user, and nothing else", async () => {
    const asserted: string[] = []
    const permission = { assert: async (input: { action: string }) => void asserted.push(input.action) }
    await probeMethod(fakeDeps(FIXTURE, permission as never)).run({}, call())
    expect(asserted).toEqual([PROBE_ACTION, "affinity_get_current_user"])
  })
})

describe("events_list", () => {
  test("lists the signed-in person's meetings oldest first, with metadata only", async () => {
    const page = await list({ account: ACCOUNT, since: SINCE })
    expect(resultProblems(page, 500, MAX_BYTES)).toEqual([])
    // 1003 is a colleague's; 1004 holds a secret; 1006 started under an hour ago; 1007 is in the future.
    expect(ids(page)).toEqual(["1000", "1001", "1002", "1005"])
    expect(page.refused).toEqual([{ external_id: "1004", reason: "secret", detail: "holds a secret (password)" }])
    expect(page.owner).toEqual({ id: "mailto:pilot.owner@example.com", label: "Pilot Owner (Example Ventures)" })
    expect(page.more).toBe(false)
    expect(page.events[1]).toMatchObject({
      source: "affinity",
      account: ACCOUNT,
      external_id: "1001",
      kind: "meeting",
      occurred_at: "2026-11-12T09:00:00.000Z",
      thread: null,
      title: "Intro: Northwind Robotics",
      text: "",
      url: null,
      labels: [],
      // Only attendees Affinity matched to a person, by their Affinity id and name.
      actors: [
        { role: "organizer", id: "affinity:person/9001", name: "Pilot Owner" },
        { role: "attendee", id: "affinity:person/502", name: "Ama Mensah" },
      ],
    })
    // No email address of anyone else leaves the plugin: the account and the owner are the signed-in person's own.
    expect(JSON.stringify(page.events.map(({ account: _account, hash: _hash, ...event }) => event))).not.toContain("@")
  })

  test("pages with the cursor: no meeting twice, none skipped, and the cost names each call", async () => {
    const known = await probed()
    const seen: string[] = []
    let input: Record<string, unknown> = { account: ACCOUNT, since: SINCE, limit: 1 }
    for (let page = 0; page < 10; page++) {
      const result = await list(input, { signIns: known })
      seen.push(...ids(result))
      expect(result.cost).toEqual({ units: [{ per: "call", count: expect.any(Number) }] })
      if (!result.more) break
      input = { account: ACCOUNT, cursor: result.cursor, limit: 1 }
    }
    expect(seen).toEqual(["1000", "1001", "1002", "1005"])
  })

  test("follows Affinity's own pages within a window, and sorts what Affinity does not", async () => {
    const calls: FakeOptions["calls"] = []
    const page = await list({ account: ACCOUNT, since: "2026-11-08T00:00:00Z" }, { pageSize: 2, calls })
    expect(ids(page)).toEqual(["1001", "1002", "1005"])
    expect(calls.map((entry) => entry.input["cursor"] === undefined)).toEqual([true, false, false])
    expect(page.cost).toEqual({ units: [{ per: "call", count: 3 }] })
  })

  test("costs one get_meetings call for a collector that runs every hour", async () => {
    const calls: FakeOptions["calls"] = []
    const first = await list({ account: ACCOUNT, since: "2026-11-12T00:00:00Z" })
    const page = await list({ account: ACCOUNT, cursor: first.cursor }, { calls, now: NOW + 3_600_000 })
    // An hour later, the stand-up that started at 11:30 has settled, and the call logged at 12:30 for the 12th's 08:00
    // is listed late, by its start, from the same call.
    expect(ids(page)).toEqual(["1008", "1006"])
    expect(calls).toHaveLength(1)
    expect(String(calls[0]!.input["filter_expr"])).toMatch(/^\(startTime>=\S+ & startTime<=\S+\) \| \(startTime>=\S+ & startTime<=\S+ & createdAt>=2026-11-13T12:00:00Z\)$/)
    expect(page.cost).toEqual({ units: [{ per: "call", count: 1 }] })
    // The next listing lists neither again.
    const again = await list({ account: ACCOUNT, cursor: page.cursor }, { now: NOW + 2 * 3_600_000 })
    expect(ids(again)).toEqual([])
  })

  test("a meeting logged late is listed once, even when a page cannot hold every late one", async () => {
    const known = await probed()
    const logged = (id: number, start: string) => ({ ...meeting(id, start), createdAt: "2026-11-13T12:10:00Z" })
    const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, logged(4001, "2026-11-11T09:00:00Z"), logged(4002, "2026-11-10T09:00:00Z"), logged(4003, "2026-11-09T09:00:00Z")] }
    const first = await list({ account: ACCOUNT, since: SINCE }, { fixture, signIns: known })
    const seen: string[] = []
    let cursor = first.cursor
    for (let page = 0; page < 6; page++) {
      const result = await list({ account: ACCOUNT, cursor, limit: 2 }, { fixture, signIns: known, now: NOW + 3_600_000 })
      seen.push(...ids(result))
      cursor = result.cursor
      if (!result.more) break
    }
    // The three late ones, two at a time by when they were logged, then what settled since.
    expect(seen.sort()).toEqual(["1006", "1008", "4001", "4002", "4003"])
  })

  test("a meeting logged more than the late reach before the position is past it", async () => {
    const known = await probed()
    const old = { ...meeting(4100, new Date(NOW - (LATE_DAYS + 2) * DAY).toISOString()), createdAt: "2026-11-13T12:10:00Z" }
    const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, old] }
    const first = await list({ account: ACCOUNT, since: SINCE }, { fixture, signIns: known })
    const page = await list({ account: ACCOUNT, cursor: first.cursor }, { fixture, signIns: known, now: NOW + 3_600_000 })
    expect(ids(page)).not.toContain("4100")
  })

  test("an empty page still names the owner and carries a cursor", async () => {
    const page = await list({ account: ACCOUNT, since: "2026-11-13T00:00:00Z" })
    expect(page.events).toEqual([])
    expect(page.owner.id).toBe("mailto:pilot.owner@example.com")
    expect(page.cursor.length).toBeGreaterThan(0)
    expect(page.more).toBe(false)
  })

  test("reads back 90 days: an older cursor restarts there with a gap, once, at most ten calls a page", async () => {
    const aged = (days: number) => encodeBoundCursor({ plugin: "affinity", source: "affinity", account: ACCOUNT }, { a: ACCOUNT, t: NOW - days * DAY, i: 0, w: NOW - days * DAY, k: 0 })
    const calls: FakeOptions["calls"] = []
    const page = await list({ account: ACCOUNT, cursor: aged(365) }, { calls })
    const horizon = new Date(NOW - READ_BACK_DAYS * DAY).toISOString()
    expect(page.gap).toEqual({ reason: "expired", since: horizon })
    expect(String(calls[0]!.input["filter_expr"])).toStartWith(`startTime>=${horizon.replace(".000Z", "Z")} `)
    expect(calls).toHaveLength(MAX_CALLS)
    expect(page.more).toBe(true)
    // The rest of the read answers no gap again.
    const next = await list({ account: ACCOUNT, cursor: page.cursor })
    expect(next.gap).toBeUndefined()
    expect(ids(next)).toEqual(["1000", "1001", "1002", "1005"])
    // A cursor inside the margin is read as it is.
    expect((await list({ account: ACCOUNT, cursor: aged(EXPIRE_DAYS - 1) })).gap).toBeUndefined()
    // A since before the horizon starts at it, and says so.
    expect((await list({ account: ACCOUNT, since: "2026-01-01" })).gap).toEqual({ reason: "window-truncated", since: horizon })
  })

  test("a busy week is read again a day at a time; a day that cannot be read whole is UNAVAILABLE", async () => {
    const busy = { ...FIXTURE, meetings: Array.from({ length: 7 }, (_, index) => meeting(2000 + index, `2026-11-0${index + 2}T10:00:00Z`)) }
    const calls: FakeOptions["calls"] = []
    const page = await list({ account: ACCOUNT, since: SINCE }, { fixture: busy, pageSize: 2, calls })
    // The week takes more than three pages of two, so it is read a day at a time from the start.
    expect(ids(page)).toEqual(busy.meetings.map((entry) => String(entry.id)))
    expect(calls.length).toBeLessThanOrEqual(MAX_CALLS + 20)
    const crowded = { ...FIXTURE, meetings: Array.from({ length: 50 }, (_, index) => meeting(3000 + index, "2026-11-02T10:00:00Z")) }
    expect(await code(list({ account: ACCOUNT, since: SINCE }, { fixture: crowded, pageSize: 2 }))).toBe("UNAVAILABLE")
  })

  test("refuses what it cannot read before any call", async () => {
    const calls: FakeOptions["calls"] = []
    const options = { calls }
    expect(await code(list({ since: SINCE }, options))).toBe("INPUT_INVALID")
    expect(await code(list({ account: "default", since: SINCE }, options))).toBe("INPUT_INVALID")
    expect(await code(list({ account: ACCOUNT, limit: 0 }, options))).toBe("INPUT_INVALID")
    expect(await code(list({ account: ACCOUNT, source: "notes" }, options))).toBe("SOURCE_UNKNOWN")
    expect(await code(list({ account: "4821/someone@example.com", since: SINCE }, options))).toBe("ACCOUNT_MISMATCH")
    const mine = (await list({ account: ACCOUNT, since: SINCE, limit: 1 })).cursor
    expect(await code(list({ account: "4821/someone@example.com", cursor: mine }, options))).toBe("ACCOUNT_MISMATCH")
    expect(await code(list({ account: ACCOUNT, cursor: "not-a-cursor" }, options))).toBe("CURSOR_INVALID")
    expect(await code(list({ account: ACCOUNT, cursor: encodeCursor("affinity", { a: ACCOUNT, t: 0, i: 0, w: 0, k: 0 }) }, options))).toBe("CURSOR_INVALID")
    expect(await code(list({ account: ACCOUNT, cursor: encodeBoundCursor({ plugin: "affinity", source: "affinity", account: ACCOUNT }, { a: ACCOUNT, t: NOW, i: 0 }) }, options))).toBe("CURSOR_INVALID")
    const other = encodeBoundCursor({ plugin: "granola", source: "affinity", account: ACCOUNT }, { a: ACCOUNT, t: 0, i: 0, w: 0, k: 0 })
    expect(await code(list({ account: ACCOUNT, cursor: other }, options))).toBe("CURSOR_INVALID")
    expect(calls).toEqual([])
  })

  test("waits for probe: no listing for a sign-in probe has not named, and none after a new sign-in", async () => {
    const calls: FakeOptions["calls"] = []
    expect(await code(list({ account: ACCOUNT, since: SINCE }, { signIns: signIns(), calls }))).toBe("UNAVAILABLE")
    const known = await probed()
    known.clear()
    expect(await code(list({ account: ACCOUNT, since: SINCE }, { signIns: known, calls }))).toBe("UNAVAILABLE")
    expect(calls).toEqual([])
  })

  test("Affinity's failures carry the contract's codes: the quota, a missing scope, anything else, an answer it cannot read", async () => {
    const failing = (message: string) => ({ fail: { tool: "get_meetings", message } })
    expect(await code(list({ account: ACCOUNT, since: SINCE }, failing("429 Rate limit exceeded")))).toBe("RATE_LIMITED")
    expect(await code(list({ account: ACCOUNT, since: SINCE }, failing("Insufficient scope: mcp.read")))).toBe("SCOPE_MISSING")
    expect(await code(list({ account: ACCOUNT, since: SINCE }, failing("Access to this tool requires unified events")))).toBe("UNAVAILABLE")
    expect(await code(list({ account: ACCOUNT, since: SINCE }, { unreadable: "No meetings." }))).toBe("UNAVAILABLE")
    // The tools RPC reports the plugin's own failure under its code, with its next step.
    const error = await list({ account: ACCOUNT, since: SINCE }, failing("429 Rate limit exceeded")).catch((caught: unknown) => caught)
    expect(pluginError(error)).toMatchObject({ code: "RATE_LIMITED", next: expect.stringContaining("later") })
    expect((error as Error).message).toMatch(/^RATE_LIMITED: .+ Next step: .+/)
  })

  test("a permission refusal passes through untouched, and nothing is read", async () => {
    const calls: FakeOptions["calls"] = []
    const refusal = new Error("PERMISSION_DENIED: affinity_events_list")
    const permission = { assert: async (input: { action: string }) => (input.action === EVENTS_ACTION ? Promise.reject(refusal) : undefined) }
    const known = await probed()
    const run = eventsMethod(fakeDeps(FIXTURE, permission as never, { signIns: known, calls })).run({ account: ACCOUNT, since: SINCE }, call())
    expect(await run.catch((caught: unknown) => caught)).toBe(refusal)
    expect(calls).toEqual([])
  })

  test("a server that is not Affinity's, or needs a sign-in, is refused with the contract's code", async () => {
    const known = await probed()
    const conflict = { ...fakeDeps(FIXTURE, OPEN, { signIns: known }), owned: () => false }
    expect(await code(eventsMethod(conflict).run({ account: ACCOUNT, since: SINCE }, call()))).toBe("UNAVAILABLE")
    const signedOut = { ...fakeDeps(FIXTURE, OPEN), tool: { list: async () => [] as never }, mcp: { list: async () => ({ data: [{ name: "affinity", status: { status: "needs_auth" } }] }) as never } }
    expect(await code(probeMethod(signedOut).run({}, call()))).toBe("NEEDS_SIGN_IN")
  })
})

describe("Affinity's answers", () => {
  test("a get_meetings page: its meetings, and the cursor in nextUrl or beside it, from text or structured output", () => {
    const body = { data: [{ id: 7, title: " Call ", startTime: "2026-11-12T09:00:00+01:00", attendeesPreview: { data: [{ emailAddress: "A@B.example", person: null }] } }], pagination: { nextUrl: "https://api.affinity.co/v2/meetings?cursor=abc&limit=100" } }
    const page = readMeetingsPage({ content: [{ type: "text", text: JSON.stringify(body) }] })
    expect(page?.next).toBe("abc")
    expect(page?.meetings[0]).toMatchObject({ id: "7", title: "Call", time: Date.parse("2026-11-12T08:00:00Z"), people: [] })
    expect([...(page?.meetings[0]?.emails ?? [])]).toEqual(["a@b.example"])
    expect(readMeetingsPage({ output: { result: { data: [], pagination: { nextCursor: "n2" } } } })).toEqual({ meetings: [], next: "n2" })
    expect(readMeetingsPage({ output: { data: [], pagination: { nextUrl: null } } })).toEqual({ meetings: [] })
    expect(readMeetingsPage({ content: "No meetings." })).toBeUndefined()
  })

  test("a meeting without an id or a zoned start is not dated; a link counts only on Affinity's hosts", () => {
    const page = readMeetingsPage({
      output: {
        data: [
          { title: "No id", startTime: "2026-11-12T09:00:00Z" },
          { id: 8, startTime: "Nov 12, 2026", url: "https://example-ventures.affinity.co/meetings/8" },
          { id: 9, startTime: "2026-11-12T09:00:00Z", url: "https://elsewhere.example/meetings/9" },
        ],
      },
    })
    expect(page?.meetings.map((entry) => [entry.id, entry.time, entry.url])).toEqual([
      ["8", undefined, "https://example-ventures.affinity.co/meetings/8"],
      ["9", Date.parse("2026-11-12T09:00:00Z"), undefined],
    ])
  })

  test("get_current_user: the organisation, the email lowercase, the name and the scopes", () => {
    expect(readCurrentUser({ output: JSON.stringify(FIXTURE.currentUser) })).toEqual({
      tenant: "4821",
      tenantName: "Example Ventures",
      email: "pilot.owner@example.com",
      name: "Pilot Owner",
      scopes: ["mcp", "mcp.read", "offline_access"],
    })
    expect(readCurrentUser({ output: { tenant: { id: 1 } } })).toBeUndefined()
  })

  test("an account is <tenant id>/<email>, lowercase", () => {
    expect(accountOf(" 4821/Pilot.Owner@Example.com ")).toBe(ACCOUNT)
    for (const value of ["default", "pilot.owner@example.com", "x/pilot.owner@example.com", "4821/not-an-email"]) expect(accountOf(value)).toBeUndefined()
  })
})
