import { affinityError } from "./constants.js"
import { ACCESS, type Access } from "./permissions.js"

interface Options {
  /** Run on an OpenCode version outside the supported range, with a warning in status. */
  readonly allowUntestedHost: boolean
  /** How much the default rules restrict: `all` allows every tool, `ask-changes` asks for a change, `read-only` denies it. */
  readonly access: Access
  /**
   * The client ID of the organisation's own Public OAuth app in Affinity, a UUID; undefined to sign in with OpenCode's
   * client URL. Not a secret, but status and errors show only its first 8 characters.
   */
  readonly clientId?: string
}

const EXAMPLE = `"plugins": [{ "package": "github:joe-broadhead/opencode-affinity#v0.0.4", "options": { "access": "ask-changes" } }]`
const ACCEPTED = {
  allowUntestedHost: "true or false (the default)",
  access: `${ACCESS.map((value) => `"${value}"`).join(", ")}, with "all" the default`,
  clientId: "the client ID of your organisation's own Public OAuth app in Affinity, a UUID",
} as const

/** An Affinity OAuth client ID: a UUID, in either case. */
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** How much of a client ID status and errors show. */
const SHOWN = 8

/** A client ID as status and errors show it: its first 8 characters, then an ellipsis. */
export const shortClientId = (clientId: string) => (clientId.length > SHOWN ? `${clientId.slice(0, SHOWN)}…` : clientId)

const CLIENT_ID_NEXT_STEP =
  "Copy the client ID of your organisation's Public OAuth app from Affinity (Settings, Manage Apps), a UUID such as 00000000-0000-0000-0000-000000000000, into the option, or remove the option to sign in with OpenCode's client URL."

const invalid = (problem: string, nextStep = `Fix the plugin options in opencode.json, for example ${EXAMPLE}.`) =>
  affinityError("OPTIONS_INVALID", `${problem}.`, nextStep)

/** Validates the plugin options from opencode.json. Every option is optional. */
export function parseOptions(raw: unknown): Options {
  if (raw === undefined || raw === null) return { allowUntestedHost: false, access: "all" }
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid(`The plugin options must be an object, found ${describe(raw)}`)
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(ACCEPTED, key)) {
      throw invalid(`Unknown option "${key}". Accepted options: ${Object.keys(ACCEPTED).map((name) => `"${name}"`).join(", ")}`)
    }
  }
  const { allowUntestedHost = false, access = "all", clientId } = input
  if (typeof allowUntestedHost !== "boolean") {
    throw invalid(`The option "allowUntestedHost" must be ${ACCEPTED.allowUntestedHost}, found ${describe(allowUntestedHost)}`)
  }
  if (!ACCESS.includes(access as Access)) {
    throw invalid(`The option "access" must be ${ACCEPTED.access}, found ${describe(access)}`)
  }
  const id = parseClientId(clientId)
  return { allowUntestedHost, access: access as Access, ...(id ? { clientId: id } : {}) }
}

/**
 * The client ID, trimmed, or undefined when it is absent or empty: Jelly saves a cleared text setting as "". Anything
 * else must be a UUID, and an error shows at most its first 8 characters, in case a secret was pasted by mistake.
 */
function parseClientId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  // A rejected value is never shown in full: a non-string by its type alone, a string by its first 8 characters.
  if (typeof value !== "string") throw invalid(`The option "clientId" must be ${ACCEPTED.clientId}, found ${typeOf(value)}`, CLIENT_ID_NEXT_STEP)
  const trimmed = value.trim()
  if (trimmed === "") return undefined
  if (!CLIENT_ID.test(trimmed)) {
    throw invalid(`The option "clientId" must be ${ACCEPTED.clientId}, found ${JSON.stringify(shortClientId(trimmed))}, which is not one`, CLIENT_ID_NEXT_STEP)
  }
  return trimmed
}

const typeOf = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "object" ? "an object" : `a ${typeof value}`

const describe = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" ? "an object" : String(value)
