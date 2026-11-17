import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/options.js"
import { ACCESS } from "../../src/permissions.js"

describe("parseOptions", () => {
  test("defaults to a tested host with every tool allowed", () => {
    expect(parseOptions(undefined)).toEqual({ allowUntestedHost: false, access: "all" })
    expect(parseOptions({})).toEqual({ allowUntestedHost: false, access: "all" })
  })

  test("accepts every documented value, and every access value", () => {
    expect(parseOptions({ allowUntestedHost: true })).toEqual({ allowUntestedHost: true, access: "all" })
    expect(parseOptions({ allowUntestedHost: false })).toEqual({ allowUntestedHost: false, access: "all" })
    for (const access of ACCESS) expect(parseOptions({ access })).toEqual({ allowUntestedHost: false, access })
  })

  // An Affinity client ID is a UUID; it is not a secret, but an error shows at most its first 8 characters.
  test("takes an organisation's client ID, trimmed, and treats an empty one as unset, as Jelly saves a cleared setting", () => {
    // Hex letters in both cases: a UUID is accepted as written, lower or upper case, and trimmed.
    const id = "abcdef00-0000-4000-8000-00000000abcd"
    expect(parseOptions({ clientId: id })).toEqual({ allowUntestedHost: false, access: "all", clientId: id })
    expect(id.toUpperCase()).not.toBe(id)
    expect(parseOptions({ clientId: ` ${id.toUpperCase()}\n` })).toEqual({ allowUntestedHost: false, access: "all", clientId: id.toUpperCase() })
    expect(parseOptions({ clientId: "ABCDEF00-0000-4000-8000-00000000abcd" }).clientId).toBe("ABCDEF00-0000-4000-8000-00000000abcd")
    for (const empty of ["", "   "]) expect(parseOptions({ clientId: empty })).toEqual({ allowUntestedHost: false, access: "all" })
  })

  test.each([
    ["https://opencode.ai/oauth/opencode/client.json"],
    ["my-client"],
    ["00000000-1111-4222-8333-44444444444"],
    ["00000000-1111-4222-8333-4444444444445"],
    ["{00000000-1111-4222-8333-444444444444}"],
    ["00000000111142228333444444444444"],
    ["sk-fake-secret-0123456789abcdef"],
    [42],
    [123456789012345],
    [true],
    [null],
    [{ id: "00000000-1111-4222-8333-444444444444" }],
    [["00000000-1111-4222-8333-444444444444"]],
  ])("refuses the client ID %j with OPTIONS_INVALID, at most its first 8 characters, and where to find the right one", (clientId) => {
    try {
      parseOptions({ clientId })
      throw new Error("accepted")
    } catch (error) {
      const { message, code, nextStep } = error as Error & { code: string; nextStep: string }
      expect(code).toBe("OPTIONS_INVALID")
      expect(message).toStartWith(`OPTIONS_INVALID: The option "clientId" must be the client ID of your organisation's own Public OAuth app in Affinity, a UUID, found `)
      expect(nextStep).toBe(
        "Copy the client ID of your organisation's Public OAuth app from Affinity (Settings, Manage Apps), a UUID such as 00000000-0000-0000-0000-000000000000, into the option, or remove the option to sign in with OpenCode's client URL.",
      )
      expect(message.endsWith(`. Next step: ${nextStep}`)).toBe(true)
      if (typeof clientId === "string") {
        expect(message).toContain(`found ${JSON.stringify(`${clientId.slice(0, 8)}…`)}, which is not one.`)
        if (clientId.length > 8) expect(message).not.toContain(clientId)
      } else {
        // A non-string is named by its type alone, never its value.
        expect(message).toMatch(/found (a number|a boolean|null|an object|an array)\. Next step/)
        expect(message).not.toContain("123456789")
        expect(message).not.toContain("1111-4222")
      }
    }
  })

  test.each([
    [{ access: "write" }, 'The option "access" must be "all", "ask-changes", "read-only", with "all" the default, found "write"'],
    [{ access: null }, 'The option "access" must be'],
    [{ apiKey: "sk-fake-000" }, 'Unknown option "apiKey"'],
    [{ allowUntestedHost: "yes" }, 'The option "allowUntestedHost" must be true or false (the default), found "yes"'],
    [{ allowUntestedHost: null }, 'The option "allowUntestedHost" must be true or false (the default), found null'],
    ["read", 'The plugin options must be an object, found "read"'],
    [[], "The plugin options must be an object, found an array"],
  ])("rejects %j with the key, the accepted values and an example", (input, problem) => {
    expect(() => parseOptions(input)).toThrow(problem)
    try {
      parseOptions(input)
    } catch (error) {
      const { message, code, nextStep } = error as Error & { code: string; nextStep: string }
      expect(code).toBe("OPTIONS_INVALID")
      expect(message.startsWith("OPTIONS_INVALID: ")).toBe(true)
      expect(nextStep).toContain(`"options": { "access": "ask-changes" }`)
      expect(message.endsWith(`. Next step: ${nextStep}`)).toBe(true)
      expect(message).not.toContain("sk-fake-000")
      expect(nextStep.endsWith(".")).toBe(true)
    }
  })
})
