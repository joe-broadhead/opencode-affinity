// The meetings source: events_list and probe against the fake Affinity of test/support/conformance.ts (the fixture's
// invented organisation, in the shapes of Affinity's API v2), and the readers of Affinity's answers.
import { describe, expect, test } from "bun:test"
import { encodeBoundCursor, encodeCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { resultProblems, type EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import { EventsFailure, EXPIRE_DAYS, MARGIN_MS, MAX_BYTES, MAX_CALLS, PROBE_ACTION, READ_BACK_DAYS, EVENTS_ACTION, accountOf, eventsMethod, probeMethod, signIns, type SignIns } from "../../src/events.js"
import { readCurrentUser, readMeetingsPage } from "../../src/meetings.js"
import { pluginError } from "../../src/tools-rpc.js"
import { ACCOUNT, CREDENTIAL, FIXTURE, NOW, OPEN, call, fakeDeps, type FakeOptions, type Fixture } from "../support/conformance.js"

const SINCE = "2026-11-01T00:00:00Z"
const DAY = 86_400_000
const HOUR = 3_600_000

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
    const page = await list({ account: ACCOUNT, cursor: first.cursor }, { calls, now: NOW + HOUR })
    // An hour later, the stand-up that started at 11:30 has settled, and the call logged at 12:30 for the 12th's 08:00
    // is listed late, before it, from the same call.
    expect(ids(page)).toEqual(["1008", "1006"])
    expect(calls).toHaveLength(1)
    // The late reach (the whole read-back, added since 10 minutes before the last listing) and the main slice, joined.
    expect(String(calls[0]!.input["filter_expr"])).toMatch(/^\(startTime>=2026-08-15T13:00:00Z & startTime<=\S+ & createdAt>=2026-11-13T11:50:00Z\) \| \(startTime>=\S+ & startTime<=\S+\)$/)
    expect(page.cost).toEqual({ units: [{ per: "call", count: 1 }] })
    // The next listing lists neither again.
    const again = await list({ account: ACCOUNT, cursor: page.cursor }, { now: NOW + 2 * HOUR })
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
      const result = await list({ account: ACCOUNT, cursor, limit: 2 }, { fixture, signIns: known, now: NOW + HOUR })
      seen.push(...ids(result))
      cursor = result.cursor
      if (!result.more) break
    }
    // The three late ones and 1008, two at a time by start, then what settled since.
    expect(seen).toEqual(["4003", "4002", "4001", "1008", "1006"])
  })

  test("the late feed covers the whole read-back: a meeting logged 60 days late is listed, one started before it is not", async () => {
    const known = await probed()
    const late = { ...meeting(4100, new Date(NOW - 60 * DAY).toISOString()), createdAt: "2026-11-13T12:10:00Z" }
    const beyond = { ...meeting(4101, new Date(NOW - (READ_BACK_DAYS + 5) * DAY).toISOString()), createdAt: "2026-11-13T12:10:00Z" }
    const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, late, beyond] }
    const first = await list({ account: ACCOUNT, since: "2026-11-12T00:00:00Z" }, { fixture, signIns: known })
    const page = await list({ account: ACCOUNT, cursor: first.cursor }, { fixture, signIns: known, now: NOW + HOUR })
    expect(ids(page)).toContain("4100")
    expect(ids(page)).not.toContain("4101")
    expect(page.gap).toBeUndefined()
  })

  test("Affinity's index lag or clock skew up to the margin skips nothing, and a meeting logged mid-listing is listed once", async () => {
    const known = await probed()
    // Logged 30 seconds before the listing, by the plugin's clock, but Affinity shows it only a minute later.
    const lagging = { ...meeting(4200, new Date(NOW - 2 * DAY).toISOString()), createdAt: new Date(NOW - 30_000).toISOString() }
    // Logged two seconds after the listing read its clock, and already visible to its call.
    const during = { ...meeting(4201, new Date(NOW - 2 * DAY).toISOString()), createdAt: new Date(NOW + 2_000).toISOString() }
    const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, lagging, during] }
    const at = (plugin: number, affinity: number) => ({ ...fakeDeps(fixture, OPEN, { signIns: known, now: affinity }), now: () => plugin })
    const first = (await eventsMethod(at(NOW, NOW - MARGIN_MS / 10)).run({ account: ACCOUNT, since: SINCE }, call())) as EventsListResult
    const seen = ids(first)
    expect(seen).not.toContain("4200")
    let cursor = first.cursor
    for (let hour = 1; hour <= 3; hour++) {
      const page = (await eventsMethod(at(NOW + hour * HOUR, NOW + hour * HOUR)).run({ account: ACCOUNT, cursor }, call())) as EventsListResult
      seen.push(...ids(page))
      cursor = page.cursor
    }
    expect(seen.filter((id) => id === "4200" || id === "4201").sort()).toEqual(["4200", "4201"])
  })

  test("an empty page still names the owner and carries a cursor", async () => {
    const page = await list({ account: ACCOUNT, since: "2026-11-13T00:00:00Z" })
    expect(page.events).toEqual([])
    expect(page.owner.id).toBe("mailto:pilot.owner@example.com")
    expect(page.cursor.length).toBeGreaterThan(0)
    expect(page.cursor.length).toBeLessThanOrEqual(1024)
    expect(page.more).toBe(false)
  })

  test("reads back 90 days: an older cursor restarts there with a gap, once", async () => {
    const known = await probed()
    const aged = async (days: number) => (await list({ account: ACCOUNT, since: new Date(NOW - (days + 1) * DAY).toISOString() }, { signIns: known, now: NOW - days * DAY })).cursor
    const calls: FakeOptions["calls"] = []
    const page = await list({ account: ACCOUNT, cursor: await aged(365) }, { calls, signIns: known })
    const horizon = new Date(NOW - READ_BACK_DAYS * DAY).toISOString()
    expect(page.gap).toEqual({ reason: "expired", since: horizon })
    expect(String(calls[0]!.input["filter_expr"])).toStartWith(`startTime>=${horizon.replace(".000Z", "Z")} `)
    expect(calls.length).toBeLessThanOrEqual(MAX_CALLS)
    expect(ids(page)).toEqual(["1000", "1001", "1002", "1005"])
    // The rest of the read answers no gap again.
    const next = await list({ account: ACCOUNT, cursor: page.cursor }, { signIns: known })
    expect(next.gap).toBeUndefined()
    expect(ids(next)).toEqual([])
    // A cursor inside the margin is read as it is.
    expect((await list({ account: ACCOUNT, cursor: await aged(EXPIRE_DAYS - 2) }, { signIns: known })).gap).toBeUndefined()
    // A since before the horizon starts at it, and says so.
    expect((await list({ account: ACCOUNT, since: "2026-01-01" })).gap).toEqual({ reason: "window-truncated", since: horizon })
  })

  /** Hourly listings from a cursor until `done` or `limit` listings; every listing's calls, and what it listed. */
  async function drain(fixture: Fixture, known: SignIns, cursor: string, done: (seen: string[]) => boolean, limit: number) {
    const seen: string[] = []
    const costs: number[] = []
    for (let hour = 1; hour <= limit && !done(seen); hour++) {
      const calls: FakeOptions["calls"] = []
      const page = await list({ account: ACCOUNT, cursor }, { fixture, signIns: known, now: NOW + hour * HOUR, calls })
      expect(page.cost).toEqual({ units: [{ per: "call", count: calls.length }] })
      costs.push(calls.length)
      seen.push(...ids(page))
      cursor = page.cursor
    }
    return { seen, costs }
  }

  test.each([2_000, 10_000])("a backfill of %i colleagues' meetings logged at once drains at no more than MAX_CALLS calls a listing", async (count) => {
    const known = await probed()
    const colleague = (id: number, start: number) => ({
      ...meeting(id, new Date(start).toISOString()),
      createdAt: new Date(NOW + 10 * 60_000).toISOString(),
      organizer: { emailAddress: "dana@example.com", person: { id: 9002, firstName: "Dana", lastName: "Lee" } },
    })
    const spread = (20 * DAY) / count
    const backfill = Array.from({ length: count }, (_, n) => colleague(100_000 + n, NOW - 20 * DAY + n * spread))
    // Three of mine in the backfill, and one ordinary meeting of mine that starts after the first listing.
    const mine = [5001, 5002, 5003].map((id, n) => ({ ...meeting(id, new Date(NOW - (3 + n * 5) * DAY).toISOString()), createdAt: new Date(NOW + 10 * 60_000).toISOString() }))
    const next = { ...meeting(5004, new Date(NOW + 30 * 60_000).toISOString()), createdAt: new Date(NOW - DAY).toISOString() }
    const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, ...backfill, ...mine, next] }
    const first = await list({ account: ACCOUNT, since: "2026-11-12T00:00:00Z" }, { fixture, signIns: known })
    const wanted = ["5001", "5002", "5003", "5004"]
    const { seen, costs } = await drain(fixture, known, first.cursor, (listed) => wanted.every((id) => listed.includes(id)), 60)
    expect(wanted.filter((id) => !seen.includes(id))).toEqual([])
    expect(new Set(seen).size).toBe(seen.length)
    expect(Math.max(...costs)).toBeLessThanOrEqual(MAX_CALLS)
    // Drained: every page of the backfill read, at a bounded cost.
    expect(costs.reduce((sum, cost) => sum + cost, 0)).toBeLessThanOrEqual(costs.length * MAX_CALLS)
    // Once drained, a listing is one call again.
    const after = await drain(fixture, known, (await list({ account: ACCOUNT, since: "2026-11-13T10:00:00Z" }, { fixture, signIns: known, now: NOW + 70 * HOUR })).cursor, () => false, 3)
    expect(after.costs.at(-1)).toBe(1)
  }, 120_000)

  test("a slice too crowded to read whole is read again narrower, never past the budget; one second that cannot be read whole is UNAVAILABLE", async () => {
    const known = await probed()
    const spread = { ...FIXTURE, meetings: Array.from({ length: 300 }, (_, n) => meeting(6000 + n, new Date(Date.parse(SINCE) + n * 600_000).toISOString())) }
    const pages: EventsListResult[] = []
    const costs: number[] = []
    let input: Record<string, unknown> = { account: ACCOUNT, since: SINCE }
    for (let n = 0; n < 80; n++) {
      const calls: FakeOptions["calls"] = []
      const page = await list(input, { fixture: spread, signIns: known, pageSize: 2, calls })
      pages.push(page)
      costs.push(calls.length)
      if (!page.more) break
      input = { account: ACCOUNT, cursor: page.cursor }
    }
    expect(pages.flatMap(ids)).toEqual(spread.meetings.map((entry) => String(entry.id)))
    expect(Math.max(...costs)).toBeLessThanOrEqual(MAX_CALLS)
    const crowded = { ...FIXTURE, meetings: Array.from({ length: 25 }, (_, n) => meeting(7000 + n, "2026-11-02T10:00:00Z")) }
    let cursor: string | undefined
    let failed: string | undefined
    for (let n = 0; n < 40 && failed === undefined; n++) {
      const calls: FakeOptions["calls"] = []
      try {
        const page = await list(cursor === undefined ? { account: ACCOUNT, since: SINCE } : { account: ACCOUNT, cursor }, { fixture: crowded, signIns: known, pageSize: 2, calls })
        cursor = page.cursor
      } catch (error) {
        failed = error instanceof EventsFailure ? error.problem.code : String(error)
      }
      expect(calls.length).toBeLessThanOrEqual(MAX_CALLS)
    }
    expect(failed).toBe("UNAVAILABLE")
  }, 120_000)

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

  describe("after a restart, with no probe in this process", () => {
    const identity = (calls: NonNullable<FakeOptions["calls"]>) => calls.filter((entry) => entry.tool === "get_current_user")
    const reads = (calls: NonNullable<FakeOptions["calls"]>) => calls.filter((entry) => entry.tool !== "get_current_user")

    test("a listing in a fresh instance answers, and names the account and owner probe names", async () => {
      const probeAnswer = await probeMethod(fakeDeps(FIXTURE, OPEN)).run({}, call())
      const calls: NonNullable<FakeOptions["calls"]> = []
      const fresh = signIns()
      const page = (await eventsMethod(fakeDeps(FIXTURE, OPEN, { signIns: fresh, calls })).run({ account: ACCOUNT, since: SINCE }, call())) as EventsListResult
      expect(page).toMatchObject({ account: ACCOUNT, owner: (probeAnswer as { owner: unknown }).owner })
      expect(ids(page).length).toBeGreaterThan(0)
      expect(resultProblems(page, 500, MAX_BYTES)).toEqual([])
      // Only the declared identity operation, once, before the listing's own reads.
      expect(calls[0]).toEqual({ tool: "get_current_user", input: {} })
      expect(identity(calls)).toHaveLength(1)
      expect(reads(calls).every((entry) => entry.tool === "get_meetings")).toBe(true)
      // Kept for the sign-in: the next listing asks Affinity nothing about who is signed in.
      expect([...fresh.keys()]).toEqual([CREDENTIAL])
      calls.length = 0
      await eventsMethod(fakeDeps(FIXTURE, OPEN, { signIns: fresh, calls })).run({ account: ACCOUNT, since: SINCE }, call())
      expect(identity(calls)).toEqual([])
    })

    test("it lists the same events as a listing after a probe", async () => {
      const afterProbe = await list({ account: ACCOUNT, since: SINCE })
      const fresh = await list({ account: ACCOUNT, since: SINCE }, { signIns: signIns() })
      expect({ ...fresh, asOf: undefined, cost: undefined }).toEqual({ ...afterProbe, asOf: undefined, cost: undefined })
    })

    test("an account that is not the signed-in one is ACCOUNT_MISMATCH, and no meeting is read", async () => {
      const calls: NonNullable<FakeOptions["calls"]> = []
      for (const account of ["4821/someone@example.com", "9999/pilot.owner@example.com"]) {
        expect(await code(list({ account, since: SINCE }, { signIns: signIns(), calls }))).toBe("ACCOUNT_MISMATCH")
      }
      expect(reads(calls)).toEqual([])
    })

    test("a request that is invalid, or a cursor for another account, reads nothing at all", async () => {
      const calls: NonNullable<FakeOptions["calls"]> = []
      const first = await list({ account: ACCOUNT, since: SINCE, limit: 2 })
      const options = { signIns: signIns(), calls }
      expect(await code(list({ since: SINCE }, options))).toBe("INPUT_INVALID")
      expect(await code(list({ account: "default" }, options))).toBe("INPUT_INVALID")
      expect(await code(list({ account: ACCOUNT, source: "notes" }, options))).toBe("SOURCE_UNKNOWN")
      expect(await code(list({ account: "4821/someone@example.com", cursor: first.cursor }, options))).toBe("ACCOUNT_MISMATCH")
      expect(calls).toEqual([])
    })

    test("the companies snapshot reads who is signed in itself too", async () => {
      const calls: NonNullable<FakeOptions["calls"]> = []
      const input = { source: "affinity", list: "companies" }
      const answer = (await eventsMethod(fakeDeps(FIXTURE, OPEN, { signIns: signIns(), calls })).run({ ...input, account: ACCOUNT }, call())) as { account: string; data: { items: unknown[] } }
      expect(answer.account).toBe(ACCOUNT)
      expect(answer.data.items.length).toBeGreaterThan(0)
      expect(calls.map((entry) => entry.tool)).toEqual(["get_current_user", "search_all_companies"])
      const other = fakeDeps(FIXTURE, OPEN, { signIns: signIns(), calls: [] })
      expect(await code(eventsMethod(other).run({ ...input, account: "4821/someone@example.com" }, call()))).toBe("ACCOUNT_MISMATCH")
    })

    test("when Affinity cannot say who is signed in, the listing fails with that read's code, keeps nothing, and tries again next time", async () => {
      const fresh = signIns()
      const calls: NonNullable<FakeOptions["calls"]> = []
      expect(await code(list({ account: ACCOUNT, since: SINCE }, { signIns: fresh, calls, fail: { tool: "get_current_user", message: "429 Rate limit exceeded" } }))).toBe("RATE_LIMITED")
      expect(await code(list({ account: ACCOUNT, since: SINCE }, { signIns: fresh, calls, fail: { tool: "get_current_user", message: "Affinity is down" } }))).toBe("UNAVAILABLE")
      const unreadable = { ...FIXTURE, currentUser: { user: {} } }
      expect(await code(list({ account: ACCOUNT, since: SINCE }, { fixture: unreadable, signIns: fresh, calls }))).toBe("UNAVAILABLE")
      expect(fresh.size).toBe(0)
      expect(reads(calls)).toEqual([])
      expect((await list({ account: ACCOUNT, since: SINCE }, { signIns: fresh })).account).toBe(ACCOUNT)
    })

    /** The fake host with get_current_user held until `release()`, so a read can be in flight while something else happens. */
    const gated = (signInMap: SignIns, calls: NonNullable<FakeOptions["calls"]>) => {
      let release = () => {}
      const open = new Promise<void>((resolve) => (release = resolve))
      const deps = fakeDeps(FIXTURE, OPEN, { signIns: signInMap, calls })
      const inner = deps.tool.list
      const tool = {
        list: async () =>
          (await inner()).map((entry) => (entry.id === "affinity_get_current_user" ? { ...entry, execute: async (input: never, context: never) => (await open, entry.execute(input, context)) } : entry)) as never,
      }
      return { deps: { ...deps, tool }, release }
    }

    test("an identity read still in flight when the kept sign-in is cleared stores nothing", async () => {
      const map = signIns()
      const calls: NonNullable<FakeOptions["calls"]> = []
      const { deps, release } = gated(map, calls)
      const running = eventsMethod(deps).run({ account: ACCOUNT, since: SINCE }, call())
      await Bun.sleep(5)
      // What the plugin does on credential.updated or credential.switched.
      map.clear()
      release()
      // The listing that asked still answers for the account it read, but the old answer is not kept for the new sign-in.
      expect(((await running) as EventsListResult).account).toBe(ACCOUNT)
      expect(map.size).toBe(0)
      calls.length = 0
      await eventsMethod(fakeDeps(FIXTURE, OPEN, { signIns: map, calls })).run({ account: ACCOUNT, since: SINCE }, call())
      expect(identity(calls)).toHaveLength(1)
    })

    test("a probe still in flight when the kept sign-in is cleared stores nothing", async () => {
      const map = signIns()
      const { deps, release } = gated(map, [])
      const running = probeMethod(deps).run({}, call())
      await Bun.sleep(5)
      map.clear()
      release()
      await running
      expect(map.size).toBe(0)
    })

    test("listings at once share one identity call", async () => {
      const map = signIns()
      const calls: NonNullable<FakeOptions["calls"]> = []
      const { deps, release } = gated(map, calls)
      const all = Promise.all([
        eventsMethod(deps).run({ account: ACCOUNT, since: SINCE }, call()),
        eventsMethod(deps).run({ account: ACCOUNT, since: SINCE }, call()),
        eventsMethod(deps).run({ source: "affinity", list: "companies", account: ACCOUNT }, call()),
      ])
      await Bun.sleep(5)
      release()
      const [first, second, companies] = (await all) as [EventsListResult, EventsListResult, { account: string }]
      expect([first.account, second.account, companies.account]).toEqual([ACCOUNT, ACCOUNT, ACCOUNT])
      expect(identity(calls)).toHaveLength(1)
      // A failed shared read is not kept as a pending one: the next listing asks again.
      const failing = signIns()
      const failedCalls: NonNullable<FakeOptions["calls"]> = []
      const broken = fakeDeps(FIXTURE, OPEN, { signIns: failing, calls: failedCalls, fail: { tool: "get_current_user", message: "Affinity is down" } })
      const both = await Promise.allSettled([eventsMethod(broken).run({ account: ACCOUNT }, call()), eventsMethod(broken).run({ account: ACCOUNT }, call())])
      expect(both.map((entry) => entry.status)).toEqual(["rejected", "rejected"])
      expect(identity(failedCalls)).toHaveLength(1)
      expect(await code(list({ account: ACCOUNT, since: SINCE }, { signIns: failing }))).toBeUndefined()
    })

    test("a new sign-in is another credential: what was read for the old one does not cover it", async () => {
      const known = await probed()
      const calls: NonNullable<FakeOptions["calls"]> = []
      const switched = { ...fakeDeps(FIXTURE, OPEN, { signIns: known, calls }), signIn: async () => "crd_other" }
      await eventsMethod(switched).run({ account: ACCOUNT, since: SINCE }, call())
      expect(identity(calls)).toHaveLength(1)
      expect([...known.keys()].sort()).toEqual([CREDENTIAL, "crd_other"].sort())
      // What the plugin does on credential.updated or credential.switched: forget, so the next listing asks again.
      known.clear()
      calls.length = 0
      await eventsMethod(fakeDeps(FIXTURE, OPEN, { signIns: known, calls })).run({ account: ACCOUNT, since: SINCE }, call())
      expect(identity(calls)).toHaveLength(1)
    })
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

  test("an answer wrapped as { result: <JSON text> }, as a server may wrap its text, is unwrapped; Markdown is not guessed at", () => {
    const user = JSON.stringify(FIXTURE.currentUser)
    expect(readCurrentUser({ output: { result: user } })).toMatchObject({ tenant: "4821", email: "pilot.owner@example.com" })
    expect(readCurrentUser({ output: JSON.stringify({ result: user }) })).toMatchObject({ tenant: "4821" })
    expect(readCurrentUser({ content: [{ type: "text", text: JSON.stringify({ result: user }) }] })).toMatchObject({ tenant: "4821" })
    const page = JSON.stringify({ data: [{ id: 7, startTime: "2026-11-12T09:00:00Z" }] })
    expect(readMeetingsPage({ output: { result: page } })?.meetings.map((entry) => entry.id)).toEqual(["7"])
    expect(readCurrentUser({ output: { result: "**Pilot Owner** (pilot.owner@example.com), Example Ventures" } })).toBeUndefined()
    expect(readMeetingsPage({ output: { result: "No meetings." } })).toBeUndefined()
  })

  test("a meeting without an id or a zoned start is not dated, and no link is read: Affinity's meetings have none", () => {
    const page = readMeetingsPage({
      output: {
        data: [
          { title: "No id", startTime: "2026-11-12T09:00:00Z" },
          { id: 8, startTime: "Nov 12, 2026", url: "https://example-ventures.affinity.co/meetings/8" },
          { id: 9, startTime: "2026-11-12T09:00:00Z", url: "https://elsewhere.example/meetings/9" },
        ],
      },
    })
    expect(page?.meetings.map((entry) => [entry.id, entry.time, "url" in entry])).toEqual([
      ["8", undefined, false],
      ["9", Date.parse("2026-11-12T09:00:00Z"), false],
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
