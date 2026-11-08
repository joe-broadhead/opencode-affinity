import type { Plugin } from "@opencode/plugin"
import { cut, oneLine } from "./redact.js"
import { SERVER_NAME } from "./constants.js"
import { delay, RESUBSCRIBE_MS } from "./watch.js"

/**
 * What status shows about the signed-in Affinity account, from the last `get_current_user` result: the organisation's
 * name and what the grant allows. Nothing else of the result is read: no user name, email or IDs, and not the
 * organisation's ID or subdomain. Kept in memory only.
 */
export interface Account {
  readonly organisation?: string
  /**
   * `read-write`: the grant carries `mcp` (or `api`); `read-only`: only `mcp.read` (or `api.read`), so Affinity refuses
   * changes; `api-key`: a personal API key, which always has full access.
   */
  readonly grant?: "read-write" | "read-only" | "api-key"
}

/** The account read; the plugin never calls it itself, so status makes no data call. */
export const ACCOUNT_TOOL = "get_current_user"

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function text(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  return content.flatMap((part) => (record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
}

const clean = (name: string) => cut(oneLine(name), 80)

/** The grant from `grant.type` and `grant.scopes`; only the known scope names are read. */
function grantOf(grant: unknown): Account["grant"] | undefined {
  if (!record(grant)) return undefined
  if (grant.type === "api-key") return "api-key"
  if (!Array.isArray(grant.scopes)) return undefined
  const scopes = grant.scopes.filter((scope): scope is string => typeof scope === "string")
  if (scopes.includes("mcp") || scopes.includes("api")) return "read-write"
  if (scopes.includes("mcp.read") || scopes.includes("api.read")) return "read-only"
  return undefined
}

/**
 * Reads `tenant.name` and `grant` from a result's structured output or its JSON text, at the top level or one level
 * down. Affinity's tool returns its whoami response, `{ tenant, user, grant }`; the shape stays unconfirmed until a
 * live call, and a result in another shape leaves the rows "not read yet", never wrong.
 */
export function accountOf(result: { readonly output?: unknown; readonly content?: unknown }): Account | undefined {
  for (const candidate of [parse(result.output), parse(text(result.content))]) {
    if (!record(candidate)) continue
    for (const fields of [candidate, ...Object.values(candidate).filter(record)]) {
      const tenant = record(fields.tenant) ? fields.tenant : undefined
      const organisation = typeof tenant?.name === "string" ? clean(tenant.name) : ""
      const grant = grantOf(fields.grant)
      const account = { ...(organisation ? { organisation } : {}), ...(grant ? { grant } : {}) }
      if (Object.keys(account).length) return account
    }
  }
  return undefined
}

type AccountResult = Parameters<typeof accountOf>[0]

interface Capture {
  readonly capture: (result: AccountResult) => void
  /** The instance's server is the user's own entry without OAuth, which signs in with its own key. */
  readonly ownSignIn: () => boolean
  /** The instance's `affinity` server is Affinity's: a server at another URL is not, and its results say nothing. */
  readonly owned: () => boolean
}

/**
 * Every running plugin instance's capture. The tools RPC's reads skip the `execute.after` hook, and its result shaping
 * learns neither the instance nor the location that served the call, so it tells every instance. That is right only
 * while they share OpenCode's one Affinity sign-in. An instance whose project adopts its own entry with an API key
 * may be another person's account, so while any instance does, a script's account read updates no status: the model
 * path, whose hook belongs to its own instance, still does.
 */
const captures = new Set<Capture>()

/** Records the account from a `get_current_user` result that a script read through the tools RPC. */
export function captureAccount(result: AccountResult): void {
  if ([...captures].some((item) => item.ownSignIn())) return
  for (const item of captures) if (item.owned()) item.capture(result)
}


/**
 * Captures the account from the model's `get_current_user` calls and the tools RPC's, and forgets it when the user
 * signs out or switches accounts. Also notes when the server's status last changed, so status can tell a server that
 * is still listing its tools from one that lists none, and remembers whether this server has connected since OpenCode
 * started, so status tells a first sign-in from an expired one. Returns the current account and a cleanup.
 */
export async function watchAccount(
  ctx: {
    readonly tool: Pick<Plugin.Context["tool"], "hook">
    readonly mcp: Pick<Plugin.Context["mcp"], "list">
    readonly event: Pick<Plugin.Context["event"], "subscribe">
  },
  ownSignIn: () => boolean = () => false,
  owned: () => boolean = () => true,
) {
  let account: Account | undefined
  let changedAt = Date.now()
  let everConnected = false
  const capture = (result: AccountResult) => void (account = accountOf(result) ?? account)
  const hook = await ctx.tool.hook("execute.after", async (event) => {
    if (event.tool === `${SERVER_NAME}_${ACCOUNT_TOOL}` && event.status === "completed" && owned()) capture(event.result)
  })
  const entry: Capture = { capture, ownSignIn, owned }
  captures.add(entry)

  const stopped = new AbortController()
  // Signed out (the server needs a sign-in again) or another account: what was read no longer holds.
  const check = async () => {
    const server = (await ctx.mcp.list()).data.find((item) => item.name === SERVER_NAME)
    if (server?.status.status === "connected") everConnected = true
    if (server?.status.status !== "connected" && server?.status.status !== "pending") account = undefined
  }
  const watching = (async () => {
    while (!stopped.signal.aborted) {
      try {
        const events = ctx.event.subscribe({ types: ["mcp.status.changed", "credential.switched"], signal: stopped.signal })
        for await (const event of events) {
          if (event.type === "credential.switched") account = undefined
          else if (event.data.server === SERVER_NAME) {
            changedAt = Date.now()
            await check().catch(() => undefined)
          }
        }
      } catch {
        // The stream failed; subscribe again.
      }
      await delay(RESUBSCRIBE_MS, stopped.signal)
    }
  })()

  return {
    current: () => account,
    /** Forgets the account, for a status read that finds the server signed out. */
    forget: () => void (account = undefined),
    changedAt: () => changedAt,
    everConnected: () => everConnected,
    stop: async () => {
      stopped.abort()
      captures.delete(entry)
      await watching
      await hook.dispose()
    },
  }
}
