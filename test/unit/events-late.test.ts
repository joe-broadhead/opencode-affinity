// The meetings source against what can go wrong at its edges: Affinity's index or clock behind the plugin's, a meeting
// logged while a listing runs, a calendar backfill, a meeting logged weeks late, the attendee preview's limit, and
// meetings that share a start. Offline: the fake Affinity of test/support/conformance.ts, with its own clock.
import { expect, test } from "bun:test"
import { MAX_CALLS, eventsMethod, probeMethod, signIns, type SignIns } from "../../src/events.js"
import { ACCOUNT, FIXTURE, NOW, OPEN, call, fakeDeps, type FakeOptions, type Fixture } from "../support/conformance.js"

const DAY = 86_400_000
const HOUR = 3_600_000
type Page = { events: { external_id: string }[]; cursor: string; more: boolean; gap?: unknown; cost?: { units: { count: number }[] } }

async function probed(fixture: Fixture = FIXTURE): Promise<SignIns> {
  const known = signIns()
  await probeMethod(fakeDeps(fixture, OPEN, { signIns: known })).run({}, call())
  return known
}

/** A listing whose clock is `pluginNow` while Affinity's clock (what it shows) is `affinityNow`. */
async function listAt(fixture: Fixture, known: SignIns, input: Record<string, unknown>, pluginNow: number, affinityNow: number, calls?: FakeOptions["calls"]): Promise<Page> {
  const deps = { ...fakeDeps(fixture, OPEN, { signIns: known, now: affinityNow, ...(calls ? { calls } : {}) }), now: () => pluginNow }
  return (await eventsMethod(deps).run(input, call())) as Page
}

const ids = (pages: readonly Page[]) => pages.flatMap((page) => page.events.map((event) => event.external_id))

const own = (id: number, start: number, created: number) => ({
  id,
  title: `Meeting ${id}`,
  startTime: new Date(start).toISOString(),
  createdAt: new Date(created).toISOString(),
  organizer: { emailAddress: "pilot.owner@example.com", person: { id: 9001, firstName: "Pilot", lastName: "Owner" } },
  creator: null,
  attendeesPreview: { data: [], totalCount: 1 },
})
const colleague = (id: number, start: number, created: number) => ({
  ...own(id, start, created),
  organizer: { emailAddress: "colleague@example.com", person: { id: 9002, firstName: "Col", lastName: "League" } },
})

/** Hourly listings after `first`, each at both clocks' hour. */
async function hourly(fixture: Fixture, known: SignIns, first: Page, hours: number, costs: number[] = []): Promise<Page[]> {
  const pages: Page[] = [first]
  for (let hour = 1; hour <= hours; hour++) {
    const calls: FakeOptions["calls"] = []
    pages.push(await listAt(fixture, known, { account: ACCOUNT, cursor: pages.at(-1)!.cursor }, NOW + hour * HOUR, NOW + hour * HOUR, calls))
    costs.push(calls.length)
  }
  return pages
}

test("Affinity's index or clock a minute behind: a meeting logged just before a listing is listed by the next one", async () => {
  const late = own(7001, NOW - 2 * DAY, NOW - 30_000)
  const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, late] }
  const known = await probed(fixture)
  const first = await listAt(fixture, known, { account: ACCOUNT, since: "2026-11-01T00:00:00Z" }, NOW, NOW - 60_000)
  expect(ids([first])).not.toContain("7001")
  const listed = ids(await hourly(fixture, known, first, 3))
  expect(listed.filter((id) => id === "7001")).toEqual(["7001"])
})

test("a meeting logged between a listing's clock and its call is listed once", async () => {
  const late = own(7002, NOW - 2 * DAY, NOW + 2_000)
  const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, late] }
  const known = await probed(fixture)
  const first = await listAt(fixture, known, { account: ACCOUNT, since: "2026-11-01T00:00:00Z" }, NOW, NOW + 5_000)
  expect(ids(await hourly(fixture, known, first, 3)).filter((id) => id === "7002")).toEqual(["7002"])
})

test("2,100 colleagues' meetings backfilled at once drain within the call budget, and the person's own are listed", async () => {
  const backfill = Array.from({ length: 2100 }, (_, n) => colleague(80000 + n, NOW - 20 * DAY + n * 60_000, NOW + 10 * 60_000))
  const mine = own(7003, NOW + 30 * 60_000, NOW - DAY)
  const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, ...backfill, mine] }
  const known = await probed(fixture)
  const first = await listAt(fixture, known, { account: ACCOUNT, since: "2026-11-12T00:00:00Z" }, NOW, NOW)
  const costs: number[] = []
  const listed = ids(await hourly(fixture, known, first, 24, costs))
  expect(listed.filter((id) => id === "7003")).toEqual(["7003"])
  expect(Math.max(...costs)).toBeLessThanOrEqual(MAX_CALLS)
}, 120_000)

test("a meeting logged 31 days after it happened is listed: the late feed covers the whole read-back", async () => {
  const late = own(7004, NOW - 31 * DAY, NOW + 10 * 60_000)
  const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, late] }
  const known = await probed(fixture)
  const first = await listAt(fixture, known, { account: ACCOUNT, since: "2026-11-12T00:00:00Z" }, NOW, NOW)
  const page = await listAt(fixture, known, { account: ACCOUNT, cursor: first.cursor }, NOW + HOUR, NOW + HOUR)
  expect(ids([page])).toContain("7004")
  expect(page.gap).toBeUndefined()
})

test("a known limit: the signed-in person past Affinity's attendee preview of a large meeting is not matched to it", async () => {
  const big = { ...colleague(7005, NOW - 2 * DAY, NOW - 3 * DAY), attendeesPreview: { data: [], totalCount: 140 } }
  const fixture = { ...FIXTURE, meetings: [...FIXTURE.meetings, big] }
  const known = await probed(fixture)
  const page = await listAt(fixture, known, { account: ACCOUNT, since: "2026-11-01T00:00:00Z" }, NOW, NOW)
  expect(ids([page])).not.toContain("7005")
})

test("meetings that share a start page one at a time with no repeat or skip", async () => {
  const t = NOW - 2 * DAY
  const ties = [3003, 3001, 3002].map((id) => own(id, t, NOW - 5 * DAY))
  const fixture = { ...FIXTURE, meetings: ties }
  const known = await probed(fixture)
  const pages: Page[] = []
  let input: Record<string, unknown> = { account: ACCOUNT, since: new Date(NOW - 3 * DAY).toISOString(), limit: 1 }
  for (let n = 0; n < 6; n++) {
    const page = await listAt(fixture, known, input, NOW, NOW)
    pages.push(page)
    if (!page.more) break
    input = { account: ACCOUNT, cursor: page.cursor, limit: 1 }
  }
  expect(ids(pages)).toEqual(["3001", "3002", "3003"])
})
