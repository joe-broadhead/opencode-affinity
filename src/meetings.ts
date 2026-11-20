/**
 * What the meetings source reads from Affinity's answers, and nothing else. Only these functions know Affinity's
 * field names, which are those of Affinity's API v2, the API its MCP server calls:
 *
 * - `get_meetings`: a page `{ data: [Meeting], pagination: { nextUrl } }`, each meeting
 *   `{ id, title, startTime, createdAt, creator, organizer, attendeesPreview: { data: [Attendee], totalCount } }`, an attendee
 *   `{ emailAddress, person: { id, firstName, lastName, primaryEmailAddress } | null }`. The next page's cursor is the
 *   `cursor` query parameter of `nextUrl`, or a `nextCursor` beside it;
 * - `get_current_user`: `{ tenant: { id, name }, user: { id, firstName, lastName, emailAddress }, grant: { scopes } }`.
 *
 * Each reader takes the answer's structured output or its JSON text, at the top level or one level down, and returns
 * nothing rather than guess. Email addresses are read only to tell whether the signed-in person took part in a
 * meeting; none leaves this module. Affinity's meeting has no link, so none is read. Affinity previews at most 100
 * attendees, so a person past the preview of a larger meeting, or invited by an alias, is not matched to it.
 */

/** A person Affinity names on a meeting: their Affinity person id, and their name when Affinity gives one. */
export interface MeetingPerson {
  readonly role: "organizer" | "creator" | "attendee"
  readonly id: string
  readonly name?: string
}

/** One meeting, as the source lists it. */
export interface MeetingFacts {
  /** Affinity's meeting id, digits. */
  readonly id: string
  readonly title?: string
  /** Epoch milliseconds: the meeting's start. */
  readonly time?: number
  /** Epoch milliseconds: when the meeting was added to Affinity, which can be after it started (a meeting logged late). */
  readonly created?: number
  /** The organizer, the creator and the attendees Affinity matched to a person record, in that order. */
  readonly people: readonly MeetingPerson[]
  /** Every email address on the meeting, lowercase: only to tell the signed-in person's meetings apart. */
  readonly emails: ReadonlySet<string>
}

/** A get_meetings page: its meetings, and the cursor of the next page when Affinity has one. */
export interface MeetingsPage {
  readonly meetings: readonly MeetingFacts[]
  readonly next?: string
}

/** Who is signed in to Affinity, from get_current_user. */
export interface CurrentUser {
  readonly tenant: string
  readonly tenantName?: string
  readonly email: string
  readonly name?: string
  readonly scopes?: readonly string[]
}

type Answer = { readonly output?: unknown; readonly content?: unknown }

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The text of a tool result, or its output when that is already text. */
export function resultText(result: Answer): string {
  if (typeof result.output === "string") return result.output
  if (typeof result.content === "string") return result.content
  if (Array.isArray(result.content)) {
    return result.content.flatMap((part) => (record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
  }
  return ""
}

/** A text that holds a JSON object, parsed; undefined when it is anything else, Markdown included. */
function jsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    const value: unknown = JSON.parse(trimmed)
    return record(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * The answer's JSON objects: its structured output, then its text parsed, each with the objects one level down. A
 * server may wrap its text as `{ "result": "<text>" }`: that text is read when it is JSON, never guessed at when it is not.
 */
function objects(result: Answer): Record<string, unknown>[] {
  const found: unknown[] = [result.output]
  const parsed = jsonObject(resultText(result))
  if (parsed !== undefined) found.push(parsed)
  for (const value of [...found]) {
    const wrapped = record(value) && typeof value.result === "string" ? jsonObject(value.result) : undefined
    if (wrapped !== undefined) found.push(wrapped)
  }
  return found.filter(record).flatMap((value) => [value, ...Object.values(value).filter(record)])
}

const EMAIL = /^[^\s@/]+@[^\s@/]+$/
const DIGITS = /^[1-9][0-9]{0,18}$/
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/

const nonEmpty = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined)
const idOf = (value: unknown) => {
  const id = typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : nonEmpty(value)
  return id !== undefined && DIGITS.test(id) ? id : undefined
}
const emailOf = (value: unknown) => {
  const email = nonEmpty(value)?.toLowerCase()
  return email !== undefined && EMAIL.test(email) ? email : undefined
}
const timeOf = (value: unknown) => {
  const text = nonEmpty(value)
  if (text === undefined || !ISO_WITH_ZONE.test(text)) return undefined
  const time = Date.parse(text)
  return Number.isFinite(time) ? time : undefined
}
const nameOf = (first: unknown, last: unknown) => [nonEmpty(first), nonEmpty(last)].filter(Boolean).join(" ") || undefined

/** One attendee: its person, when Affinity matched one, and its email addresses. */
function attendee(value: unknown, role: MeetingPerson["role"], emails: Set<string>): MeetingPerson | undefined {
  if (!record(value)) return undefined
  const person = record(value.person) ? value.person : undefined
  for (const email of [value.emailAddress, person?.primaryEmailAddress, ...(Array.isArray(person?.emailAddresses) ? person.emailAddresses : [])]) {
    const address = emailOf(email)
    if (address) emails.add(address)
  }
  const id = idOf(person?.id)
  if (id === undefined) return undefined
  const name = nameOf(person?.firstName, person?.lastName)
  return { role, id, ...(name ? { name } : {}) }
}

function meetingFacts(value: unknown): MeetingFacts | undefined {
  if (!record(value)) return undefined
  const id = idOf(value.id)
  if (id === undefined) return undefined
  const emails = new Set<string>()
  const preview = record(value.attendeesPreview) ? value.attendeesPreview.data : value.attendees
  const people = [
    attendee(value.organizer, "organizer", emails),
    attendee(value.creator, "creator", emails),
    ...(Array.isArray(preview) ? preview.map((entry) => attendee(entry, "attendee", emails)) : []),
  ].filter((person): person is MeetingPerson => person !== undefined)
  const title = nonEmpty(value.title)
  const time = timeOf(value.startTime)
  const created = timeOf(value.createdAt)
  return { id, ...(title ? { title } : {}), ...(time === undefined ? {} : { time }), ...(created === undefined ? {} : { created }), people, emails }
}

/** The next page's cursor: `nextCursor`, or the `cursor` query parameter of `nextUrl`, in `pagination` or beside it. */
function nextCursor(page: Record<string, unknown>): string | undefined {
  const pagination = record(page.pagination) ? page.pagination : {}
  const direct = nonEmpty(pagination.nextCursor) ?? nonEmpty(page.nextCursor) ?? nonEmpty(page.next_cursor)
  if (direct) return direct
  const nextUrl = nonEmpty(pagination.nextUrl) ?? nonEmpty(page.nextUrl)
  if (!nextUrl) return undefined
  try {
    return nonEmpty(new URL(nextUrl).searchParams.get("cursor"))
  } catch {
    return undefined
  }
}

/** A get_meetings page; undefined when the answer holds no list of meetings at all, so it cannot be read. */
export function readMeetingsPage(result: Answer): MeetingsPage | undefined {
  for (const page of objects(result)) {
    const list = page.data ?? page.meetings
    if (!Array.isArray(list)) continue
    const next = nextCursor(page)
    return { meetings: list.flatMap((value) => meetingFacts(value) ?? []), ...(next ? { next } : {}) }
  }
  return undefined
}

/** Who is signed in, from get_current_user: the tenant's id and name, the user's email and name, and the grant's scopes. */
export function readCurrentUser(result: Answer): CurrentUser | undefined {
  for (const answer of objects(result)) {
    const tenant = record(answer.tenant) ? answer.tenant : undefined
    const user = record(answer.user) ? answer.user : undefined
    const tenantId = idOf(tenant?.id)
    const email = emailOf(user?.emailAddress)
    if (tenantId === undefined || email === undefined) continue
    const tenantName = nonEmpty(tenant?.name)
    const name = nameOf(user?.firstName, user?.lastName)
    const grant = record(answer.grant) ? answer.grant : undefined
    const scopes = Array.isArray(grant?.scopes) ? [...new Set(grant.scopes.flatMap((scope) => nonEmpty(scope) ?? []))] : undefined
    return { tenant: tenantId, email, ...(tenantName ? { tenantName } : {}), ...(name ? { name } : {}), ...(scopes ? { scopes } : {}) }
  }
  return undefined
}
