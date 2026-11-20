/**
 * What the companies list snapshot reads from Affinity's `search_all_companies` answer, and nothing else. The page is
 * Affinity's API v2 shape, `{ data: [Company], pagination }`, a company `{ id, name, domain }`. The MCP tool returns
 * that page as structured output or as JSON text. Fields, email addresses and scores are not read. A name or domain
 * that holds a secret is left out of the list.
 */
import { secretKinds } from "@we-the-rebel-alliance/source-contract/events"

/** The `list` input `events_list` takes for this snapshot, and the source id a consumer binds. */
export const COMPANIES_LIST = "companies"
export const COMPANIES_ID = "affinity.companies"
/** The list registry holds 50 items. The read asks Affinity for that many and returns no more. */
export const LIST_CAP = 50

/** One company, as the list shows it: Affinity's id, the name, and the primary domain when Affinity gives one. */
export interface CompanyFacts {
  readonly id: string
  readonly name: string
  readonly domain?: string
}

/** One row of the contract's `list` output. */
export interface CompanyItem {
  readonly id: string
  readonly text: string
  readonly note?: string
}

type Answer = { readonly output?: unknown; readonly content?: unknown }

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined)
const DIGITS = /^[1-9][0-9]{0,18}$/

const idOf = (value: unknown) => {
  const id = typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : nonEmpty(value)
  return id !== undefined && DIGITS.test(id) ? id : undefined
}

/** A primary domain: no space, no address, and short enough for a note. Anything else is left out. */
const domainOf = (value: unknown) => {
  const domain = nonEmpty(value)
  return domain !== undefined && domain.length <= 200 && !/[\s@]/.test(domain) ? domain : undefined
}

const textOf = (result: Answer): string => {
  if (typeof result.output === "string") return result.output
  if (typeof result.content === "string") return result.content
  if (Array.isArray(result.content)) {
    return result.content.flatMap((part) => (record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
  }
  return ""
}

/** The answer's JSON objects: its structured output, then its text parsed, each with the objects one level down. */
function objects(result: Answer): Record<string, unknown>[] {
  const found: unknown[] = [result.output]
  const text = textOf(result).trim()
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      found.push(JSON.parse(text))
    } catch {
      // Not JSON: nothing to read.
    }
  }
  return found.filter(record).flatMap((value) => [value, ...Object.values(value).filter(record)])
}

function companyOf(value: unknown): CompanyFacts | undefined {
  if (!record(value)) return undefined
  const id = idOf(value.id)
  const name = nonEmpty(value.name)
  if (id === undefined || name === undefined) return undefined
  const domain = domainOf(value.domain)
  return { id, name, ...(domain === undefined ? {} : { domain }) }
}

/**
 * A `search_all_companies` page; undefined when the answer holds no list of companies at all, so it cannot be read.
 * An entry without an id or a name is skipped. An empty list is a page.
 */
export function readCompanies(result: Answer): CompanyFacts[] | undefined {
  for (const page of objects(result)) {
    const list = page.data ?? page.companies ?? page.items
    if (!Array.isArray(list)) continue
    return list.flatMap((value) => companyOf(value) ?? [])
  }
  const parsed = textOf(result).trim()
  if (parsed.startsWith("[")) {
    try {
      const list = JSON.parse(parsed) as unknown
      if (Array.isArray(list)) return list.flatMap((value) => companyOf(value) ?? [])
    } catch {
      // Not a list.
    }
  }
  return undefined
}

/** The most JSON bytes one list answer may take: the declared `maxBytes`, with room for the envelope. */
const LIST_BUDGET = 60_000
/** Control characters would escape to six bytes each in JSON and only make a title unreadable. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g

/** Collapse whitespace and drop control characters, so a cut is a cut of text a person can read. */
const clean = (value: string) => value.replace(CONTROLS, " ").replace(/\s+/g, " ").trim()

/**
 * The contract's `list` items: id, name, and the domain as a note. A name or domain that holds a secret is left out,
 * screened whole and only then cut to the item's length, so a secret that straddles the cut cannot pass as a prefix.
 * Affinity's own order is kept, a repeated id is listed once, and items stop before the answer passes its byte budget.
 */
export function companyItems(companies: readonly CompanyFacts[]): CompanyItem[] {
  const items: CompanyItem[] = []
  const seen = new Set<string>()
  let bytes = 0
  for (const company of companies) {
    if (items.length >= LIST_CAP) break
    if (seen.has(company.id)) continue
    const name = clean(company.name)
    const domain = company.domain === undefined ? undefined : clean(company.domain)
    if (name === "" || secretKinds(name).length > 0 || (domain !== undefined && secretKinds(domain).length > 0)) continue
    const item: CompanyItem = { id: company.id, text: name.slice(0, 200), ...(domain === undefined || domain === "" ? {} : { note: domain.slice(0, 200) }) }
    const size = JSON.stringify(item).length + 1
    if (bytes + size > LIST_BUDGET) break
    bytes += size
    seen.add(company.id)
    items.push(item)
  }
  return items
}
