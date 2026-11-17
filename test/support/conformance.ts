// source-contract's conformance kit over this plugin's own `events_list` and `probe`, as setup registers them, against
// a fake Affinity that answers from test/fixtures/conformance.json in the shapes of Affinity's API v2. No live call is
// made. Each read runs in the kit's recording permission: the plugin's own asserts go to it, and so does every Affinity
// tool the fake host's executor runs (`affinity_<tool>`, as OpenCode's executor asserts it), so declared must equal
// asserted. `npm run conformance` writes the report (reports/conformance-report.json); test/unit/sources.test.ts asserts
// it, and the events tests use the same fake.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { sourceConformance, type ConformanceReport, type PageCase, type SessionContext, type ToolDeclaration } from "@we-the-rebel-alliance/source-contract/conformance"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { readInstalledDescriptor, type InstalledDescriptor } from "@we-the-rebel-alliance/source-contract/descriptor"
import { SOURCES_SCHEMA } from "@we-the-rebel-alliance/source-contract/schema"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PACKAGE, SOURCE, eventsMethod, probeMethod, signIns, type EventsDeps, type SignIns } from "../../src/events.js"
import { METHODS, TOOLS_RPC_ID } from "../../src/tools-rpc.js"

export const ROOT = join(import.meta.dir, "..", "..")

export interface Fixture {
  readonly now: string
  readonly currentUser: Record<string, unknown>
  readonly meetings: readonly Record<string, unknown>[]
}

export const FIXTURE = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "conformance.json"), "utf8")) as Fixture
export const NOW = Date.parse(FIXTURE.now)
/** The account probe names for the fixture: the organisation's id and the signed-in email, lowercase. */
export const ACCOUNT = "4821/pilot.owner@example.com"
/** OpenCode's credential for the server in the fake host. */
export const CREDENTIAL = "crd_conformance"

/** How the fake Affinity answers: its page size, a failure for one tool, or no list at all. */
export interface FakeOptions {
  /** Meetings per page, below what the caller asks: 100 by default, as Affinity's most. */
  readonly pageSize?: number
  /** Affinity's own failure text for this tool, thrown as a Tool.Error without a cause, as OpenCode's executor does. */
  readonly fail?: { readonly tool: string; readonly message: string }
  /** get_meetings answers this text instead of a page. */
  readonly unreadable?: string
  /** Every call, in order: the tool and its input. */
  readonly calls?: { tool: string; input: Record<string, unknown> }[]
  /** The clock: the fixture's now by default. */
  readonly now?: number
}

/**
 * The filters the source sends, in Affinity's filter language: `startTime>=<ISO> & startTime<=<ISO>`, or that in
 * parentheses `|` a late reach, `(startTime>=<ISO> & startTime<=<ISO> & createdAt>=<ISO>)`, or either alone. Returns the test a meeting
 * passes; anything else is Affinity's refusal of the filter.
 */
function matcher(filter: unknown): (meeting: Record<string, unknown>) => boolean {
  const text = String(filter)
  const disjuncts = (text.includes(" | ") ? text.split(" | ").map((part) => /^\((.*)\)$/.exec(part)?.[1]) : [text]).map((part) =>
    part?.split(" & ").map((condition) => /^(startTime|createdAt)(>=|<=|>|<)(\S+Z)$/.exec(condition)),
  )
  if (disjuncts.some((conditions) => conditions === undefined || conditions.some((condition) => condition === null))) throw new ToolError({ message: `Invalid filter_expr: ${text}` })
  const holds = (value: number, op: string, bound: number) => (op === ">=" ? value >= bound : op === "<=" ? value <= bound : op === ">" ? value > bound : value < bound)
  return (meeting) => disjuncts.some((conditions) => conditions!.every((match) => holds(Date.parse(String(meeting[match![1]!])), match![2]!, Date.parse(match![3]!))))
}

/**
 * Affinity's get_meetings: the meetings whose start is in the filter's window, in an order Affinity does not promise
 * (newest first here, so the source must sort), paged by an opaque cursor in `pagination.nextUrl`.
 */
function meetingsAnswer(fixture: Fixture, input: Record<string, unknown>, options: FakeOptions): string {
  const passes = matcher(input["filter_expr"])
  // A meeting added to Affinity after the fake's clock does not exist yet.
  const clock = options.now ?? NOW
  const matching = fixture.meetings.filter((meeting) => Date.parse(String(meeting["createdAt"])) <= clock && passes(meeting))
  matching.sort((a, b) => Date.parse(String(b["startTime"])) - Date.parse(String(a["startTime"])))
  const size = Math.min(Number(input["limit"] ?? 100), options.pageSize ?? 100)
  const offset = input["cursor"] === undefined ? 0 : Number(Buffer.from(String(input["cursor"]), "base64url").toString("utf8").replace(/^after:/, ""))
  const data = matching.slice(offset, offset + size)
  const next = offset + size < matching.length ? Buffer.from(`after:${offset + size}`).toString("base64url") : undefined
  return JSON.stringify({ data, pagination: { prevUrl: null, nextUrl: next === undefined ? null : `https://api.affinity.co/v2/meetings?cursor=${next}&limit=${size}` } })
}

/**
 * OpenCode's executors for Affinity's reads, answering from the fixture; each asserts `affinity_<tool>` on `permission`
 * first, as the host does, and answers as an MCP tool does: its JSON as text.
 */
export function fakeTools(fixture: Fixture, permission: SessionContext["permission"], options: FakeOptions = {}) {
  const answers: Record<string, (input: Record<string, unknown>) => string> = {
    get_current_user: () => JSON.stringify(fixture.currentUser),
    get_meetings: (input) => options.unreadable ?? meetingsAnswer(fixture, input, options),
  }
  return Object.entries(answers).map(([tool, answer]) => ({
    id: `affinity_${tool}`,
    execute: async (input: Record<string, unknown>) => {
      await permission.assert({ action: `affinity_${tool}`, resources: ["*"] } as never)
      options.calls?.push({ tool, input })
      if (options.fail?.tool === tool) throw new ToolError({ message: options.fail.message })
      return { output: answer(input), content: [{ type: "text", text: answer(input) }] }
    },
  }))
}

/** The source's dependencies in the fake host: its tools, a connected server, and the kit's permission. */
export function fakeDeps(fixture: Fixture, permission: SessionContext["permission"], options: FakeOptions & { readonly signIns?: SignIns } = {}): EventsDeps {
  const tools = fakeTools(fixture, permission, options)
  return {
    tool: { list: async () => tools as never },
    mcp: { list: async () => ({ data: [{ name: "affinity", status: { status: "connected" } }] }) as never },
    permission: permission as never,
    owned: () => true,
    signIn: async () => CREDENTIAL,
    signIns: options.signIns ?? signIns(),
    now: () => options.now ?? NOW,
  }
}

export const call = (): ToolCall => ({ sessionID: "ses_conformance", agent: "build", messageID: "msg_conformance", id: "call_conformance", signal: new AbortController().signal, progress: async () => {} })
export const OPEN: SessionContext["permission"] = { assert: async () => {} }

/** The plugin's tools RPC methods, as describe lists them: the tools a source may name, each read-only or not. */
export function declaredTools(): ToolDeclaration[] {
  const deps = fakeDeps(FIXTURE, OPEN)
  return [...METHODS, eventsMethod(deps), probeMethod(deps)].map((method) => ({ id: method.name, readOnly: method.class === "read" }))
}

/** The repository's package.json, read as a consumer reads an installed plugin: checked, then hashed. */
export function installed(): InstalledDescriptor {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }
  const checked = readInstalledDescriptor(ROOT, { version: pkg.version })
  if (!checked.ok) throw new Error(`package.json's sources: ${checked.problems.join("; ")}`)
  return checked.value
}

/** package.json's sources, as Memory's schema parses them for the kit. */
export function declaredSources() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { sources: unknown }
  const checked = SOURCES_SCHEMA.check(pkg.sources)
  if (!checked.ok) throw new Error(`package.json's sources: ${checked.problems.join("; ")}`)
  return checked.value
}

/** Why no single meeting can fail on its own, for the kit's `failed-holds-cursor` check. */
export const ATOMIC =
  "events_list reads every get_meetings page of a window before it lists any meeting of it, and a failed call fails the whole events_list, so no single meeting can fail on its own"


/** The kit's report for every declared source. */
export async function conformanceReports(fixture: Fixture = FIXTURE): Promise<ConformanceReport[]> {
  // Read as a consumer reads it first (the frame, checked and hashed), then as the kit reads it (Memory's schema).
  installed()
  const sources = declaredSources()
  // Probe has named the sign-in once, as a consumer's bind does, before any listing.
  const known = signIns()
  await probeMethod(fakeDeps(fixture, OPEN, { signIns: known })).run({}, call())
  const deps = (session: SessionContext) => fakeDeps(fixture, session.permission, { signIns: known })
  const list = (input: Readonly<Record<string, unknown>>, session: SessionContext) => eventsMethod(deps(session)).run(input, call())
  const first = (await eventsMethod(fakeDeps(fixture, OPEN, { signIns: known })).run({ account: ACCOUNT, since: "2026-11-01T00:00:00Z", limit: 2 }, call())) as { cursor: string }
  const bound = (binding: { plugin: string; source: string; account: string }) => encodeBoundCursor(binding, { a: binding.account, t: Date.parse("2026-11-01T00:00:00Z"), i: 0, w: NOW, k: 0 })
  // A cursor a listing wrote 120 days ago.
  const then = NOW - 120 * 86_400_000
  const aged = ((await eventsMethod(fakeDeps(fixture, OPEN, { signIns: known, now: then })).run({ account: ACCOUNT, since: new Date(then - 86_400_000).toISOString() }, call())) as { cursor: string }).cursor
  const cases: PageCase[] = [
    { name: "a first listing for the account probe names, a colleague's meeting left out and one meeting refused for a secret", input: { source: SOURCE, account: ACCOUNT, since: "2026-11-01T00:00:00Z" } },
    { name: "the first two meetings, then more", input: { account: ACCOUNT, since: "2026-11-01T00:00:00Z", limit: 2 } },
    { name: "what came after the first two", input: { account: ACCOUNT, cursor: first.cursor } },
    { name: "an empty page still carries a cursor", input: { account: ACCOUNT, since: "2026-11-13T00:00:00Z" }, expect: "empty" },
    // 120 days old: past the 100 days a cursor lasts, so the read restarts 90 days back, says so once, and reads on.
    { name: "a cursor older than the source reads back answers a gap and reads on", input: { account: ACCOUNT, cursor: aged }, expect: "expired" },
    { name: "a since before the 90 days the source reads back starts there, with a gap", input: { account: ACCOUNT, since: "2026-01-01T00:00:00Z" } },
    { name: "a listing that names no account", input: { since: "2026-11-01T00:00:00Z" }, expect: { refuses: "INPUT_INVALID" } },
    { name: "another account than the one signed in", input: { account: "4821/someone@example.com", since: "2026-11-01T00:00:00Z" }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    { name: "a cursor passed for another account", input: { account: "4821/someone@example.com", cursor: first.cursor }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    { name: "another source's cursor", input: { account: ACCOUNT, cursor: bound({ plugin: "affinity", source: "changes", account: ACCOUNT }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "a cursor bound to another plugin", input: { account: ACCOUNT, cursor: bound({ plugin: "granola", source: SOURCE, account: ACCOUNT }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "a source this plugin does not have", input: { account: ACCOUNT, source: "notes" }, expect: { refuses: "SOURCE_UNKNOWN" } },
  ]
  const reports: ConformanceReport[] = []
  for (const source of sources.items) {
    if (source.id !== "affinity.meetings") throw new Error(`${source.id} is declared and the conformance run has no calls for it`)
    reports.push(
      await sourceConformance({
        plugin: PACKAGE,
        source,
        tools: declaredTools(),
        calls: { list, probe: (input, session) => probeMethod(deps(session)).run(input, call()) },
        cases,
        account: ACCOUNT,
        sources: { rpc: sources.rpc, probe: sources.probe },
        describe: { id: TOOLS_RPC_ID },
        atomicPages: { reason: ATOMIC },
      }),
    )
  }
  return reports
}
