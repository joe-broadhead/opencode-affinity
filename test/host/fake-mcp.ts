// A loopback Streamable-HTTP MCP server. By default it lists two known reads (one the account read), one known write,
// the ten destructive tools and one tool the plugin has never seen. With `catalog: "affinity"` it lists every tool in
// src/affinity-tools.ts and the new tool. It answers JSON-RPC POSTs with plain JSON (no SSE stream) and records every
// tool call, its path and every request header. A `tools/call` answers with the tool's name, the path and its
// arguments as structured content; for a `query` that starts with "text", with text alone; or, for a `query` that
// starts with "fail", with an upstream error (`isError`) whose first line holds a signed URL. `get_current_user` answers
// with a fake account, in the shape of Affinity's whoami. The same server is also an LM Studio-compatible model API for
// a scripted model (`model.script`), so a host test can run a real session turn that calls Affinity's tools.
//
// It is also the authorization server its 401 challenge names, as Affinity's: protected-resource and authorization
// server metadata that support a client metadata document (CIMD) and no dynamic registration, and an authorize
// endpoint that refuses OpenCode's client, as Affinity does until an organisation adds it: with its own error page
// (`refuse: "page"`, Affinity's documented behaviour) or with a redirect that carries an `error` (`refuse: "redirect"`).
// With `refuse: "sign-in"` it behaves as a signed-in browser: the authorization endpoint redirects the loopback callback
// with a code, and the token endpoint exchanges it for a token, so a host test can complete OpenCode's sign-in.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { DESTRUCTIVE_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/affinity-tools.js"

const schema = { type: "object", properties: { query: { type: "string" }, term: { type: "string" } } }
/** A tool the plugin has never seen. */
export const NEW_TOOL = { name: "shiny_new_tool", description: "A tool added upstream after the tool lists were written", annotations: {} }
const tool = (name: string, readOnlyHint: boolean) => ({ name, description: `Affinity ${name}`, annotations: { readOnlyHint }, inputSchema: schema })
const TOOLS = [tool("search_persons", true), tool("get_current_user", true), tool("create_note", false), ...DESTRUCTIVE_TOOLS.map((name) => tool(name, false)), { ...NEW_TOOL, inputSchema: schema }]
const CATALOG = [...READ_TOOLS.map((name) => tool(name, true)), ...[...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((name) => tool(name, false)), { ...NEW_TOOL, inputSchema: schema }]

/** The upstream error a "fail" query gets: two lines, the first with a signed URL. */
export const UPSTREAM_FAILURE = "Affinity refused https://files.affinity.co/a.png?signature=fake-signature-123 for this input\nTraceback: second line"

/** A fake account, in the shape of Affinity's whoami, which get_current_user returns. */
export const ACCOUNT = {
  tenant: { id: "tenant_fake_1", name: "Northwind Capital", subdomain: "northwind-fake" },
  user: { id: "u_fake_1", firstName: "Jane", lastName: "Doe", emailAddress: "jane.doe@example.com" },
  grant: { type: "access-token", scopes: ["mcp.read", "offline_access"], createdAt: "2026-01-01T00:00:00Z" },
}

/** The scopes the plugin pins, which every token is issued for. */
export const CHALLENGE_SCOPE = "mcp mcp.read offline_access"

/**
 * The wider list the fake advertises, as Affinity's own metadata and 401 do: `api`/`api.read` are in the metadata's
 * `scopes_supported`, and the challenge asks for more than the pin. A plugin without `oauth.scope` would request this
 * instead (OpenCode 2.2.x resolves `oauth?.scope ?? challenge.scope`), so the pin test fails without the pin.
 */
export const ADVERTISED_SCOPE = "mcp mcp.read mcp.write api api.read offline_access"

export interface FakeMcpOptions {
  /** `affinity` lists every tool the plugin knows, and the new tool. */
  readonly catalog?: "affinity"
  /** The scope the 401 challenge asks for; the wider list by default. */
  readonly challengeScope?: string
  /**
   * Whether the token endpoint issues a refresh token. Without one, a 401 later needs a new sign-in and leaves the
   * credential in place, which is the `/connect` account the plugin marks.
   */
  readonly refreshTokens?: boolean
}

/** The scripted model's id, as the fake's model API lists it. */
export const MODEL_ID = "fake-model"

/** A tool call the scripted model makes: the n-th call follows n tool results. */
interface ScriptedCall {
  readonly tool: string
  readonly arguments: Record<string, unknown>
}

export interface FakeMcp {
  readonly url: string
  /**
   * While true, every MCP request gets 401 with a bearer challenge, as Affinity's server answers before a sign-in or
   * after its tokens are revoked. The model API keeps answering.
   */
  challenge: boolean
  /** The server's origin; `${origin}/v1` is the model API. */
  readonly origin: string
  readonly model: {
    /** The calls the model makes, one per turn, before it answers with text. */
    script: ScriptedCall[]
    /** Every chat request body, in order. */
    readonly requests: unknown[]
  }
  /** Tool names called, in order. */
  readonly calls: string[]
  /** Each tool call with the path it was sent to, in order. */
  readonly called: { readonly tool: string; readonly path: string }[]
  /** Each tool call's arguments, in order. */
  readonly inputs: { readonly tool: string; readonly arguments: unknown }[]
  /** How the authorize endpoint answers: Affinity's own error page, a redirect with an `error`, or a sign-in. */
  refuse: "page" | "redirect" | "sign-in"
  /** The scope the 401 challenge asks for, and the metadata advertises. */
  challengeScope: string
  /** Each authorize request's query: client_id, scope, redirect_uri and the rest. */
  readonly authorizeRequests: Record<string, string>[]
  /** Each token request's form, in order. */
  readonly tokens: Record<string, string>[]
  /** The `x-affinity-test` header of every request, to tell whose server config the host used. */
  readonly markers: (string | undefined)[]
  /** The `authorization` header of every request. */
  readonly authorizations: (string | undefined)[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { protocolVersion?: string; name?: string; arguments?: { query?: unknown } } }

export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  const calls: string[] = []
  const called: { tool: string; path: string }[] = []
  const inputs: { tool: string; arguments: unknown }[] = []
  const markers: (string | undefined)[] = []
  const authorizations: (string | undefined)[] = []
  const answer = (message: Message, path: string) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-affinity", version: "0.0.0" } })
      case "tools/list":
        return reply({ tools: options.catalog === "affinity" ? CATALOG : TOOLS })
      case "tools/call": {
        const name = message.params?.name ?? ""
        calls.push(name)
        called.push({ tool: name, path })
        const args = message.params?.arguments ?? {}
        inputs.push({ tool: name, arguments: args })
        if (name === "get_current_user") return reply({ content: [{ type: "text", text: JSON.stringify(ACCOUNT) }], structuredContent: ACCOUNT })
        if (String(args.query ?? "").startsWith("fail")) return reply({ content: [{ type: "text", text: UPSTREAM_FAILURE }], isError: true })
        if (String(args.query ?? "").startsWith("text")) return reply({ content: [{ type: "text", text: `text from ${name}` }] })
        return reply({ content: [{ type: "text", text: `called ${name}` }], structuredContent: { tool: name, path, arguments: args } })
      }
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }
  const model = { script: [] as ScriptedCall[], requests: [] as unknown[] }
  // Filled once the server listens; the request handler reads `challenge` and `origin` from it.
  const fake = { challenge: false, refuse: "page", challengeScope: options.challengeScope ?? ADVERTISED_SCOPE, authorizeRequests: [] as Record<string, string>[], tokens: [] as Record<string, string>[] } as FakeMcp
  let codes = 0
  /**
   * One streamed chat completion. A request that offers tools is an agent turn: after n tool results the model makes
   * the n-th scripted call, then answers "Done.". Any other request, such as a title, gets text.
   */
  const chat = (response: ServerResponse, body: string) => {
    const request = JSON.parse(body) as { tools?: unknown[]; messages?: { role: string }[] }
    model.requests.push(request)
    const results = (request.messages ?? []).filter((message) => message.role === "tool").length
    const call = request.tools?.length ? model.script[results] : undefined
    const chunk = (delta: unknown, finish: string | null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const usage = `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`
    const delta = call
      ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${results + 1}`, type: "function", function: { name: call.tool, arguments: JSON.stringify(call.arguments) } }] }
      : { role: "assistant", content: "Done." }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(`${chunk(delta, null)}${chunk({}, call ? "tool_calls" : "stop")}${usage}data: [DONE]\n\n`)
  }
  const server = createServer(async (request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    if (route === "/api/v1/models") {
      const models = [{ type: "llm", key: MODEL_ID, display_name: "Fake model", loaded_instances: [], max_context_length: 32_000, capabilities: { vision: false, trained_for_tool_use: true } }]
      return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ models }))
    }
    if (route === "/v1/chat/completions") return chat(response, await read(request))
    // The authorization server, as Affinity's: CIMD and the `none` auth method, no registration endpoint.
    if (route === "/.well-known/oauth-protected-resource/mcp" || route === "/.well-known/oauth-protected-resource") {
      const metadata = { resource: fake.url, authorization_servers: [fake.origin], bearer_methods_supported: ["header"], scopes_supported: fake.challengeScope.split(" ") }
      return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(metadata))
    }
    if (route === "/.well-known/oauth-authorization-server") {
      const metadata = {
        issuer: fake.origin,
        authorization_endpoint: `${fake.origin}/auth/oauth2/authorize`,
        token_endpoint: `${fake.origin}/auth/oauth2/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
        scopes_supported: [...new Set(["api", "api.read", ...fake.challengeScope.split(" ")])],
        client_id_metadata_document_supported: true,
      }
      return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(metadata))
    }
    if (route === "/auth/oauth2/authorize") {
      const query = Object.fromEntries(new URL(request.url ?? "/", fake.origin).searchParams)
      fake.authorizeRequests.push(query)
      if (fake.refuse === "page") return void response.writeHead(400, { "content-type": "text/html" }).end("<html><body>This app is not allowed in your organization.</body></html>")
      const back = new URL(query.redirect_uri ?? `${fake.origin}/nowhere`)
      if (query.state) back.searchParams.set("state", query.state)
      if (fake.refuse === "redirect") {
        back.searchParams.set("error", "unauthorized_client")
        back.searchParams.set("error_description", "The client is not allowed in this organization")
      } else back.searchParams.set("code", `fake-code-${++codes}`)
      return void response.writeHead(302, { location: back.toString() }).end()
    }
    if (route === "/auth/oauth2/token" && request.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await read(request)))
      fake.tokens.push(form)
      // While the server challenges, a refresh is refused like a revoked token: the person must sign in again.
      if (fake.challenge && form.grant_type === "refresh_token") return void response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }))
      return void response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          access_token: `fake-access-${fake.tokens.length}`,
          token_type: "Bearer",
          expires_in: 3600,
          ...(options.refreshTokens === false ? {} : { refresh_token: `fake-refresh-${fake.tokens.length}` }),
          scope: CHALLENGE_SCOPE,
        }),
      )
    }
    if (route === "/auth/oauth2/token") return void response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_client" }))
    markers.push(header(request, "x-affinity-test"))
    authorizations.push(header(request, "authorization"))
    if (fake.challenge) {
      const metadata = `${fake.origin}/.well-known/oauth-protected-resource/mcp`
      return void response
        .writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${metadata}", scope="${fake.challengeScope}"` })
        .end(JSON.stringify({ error: "invalid_token" }))
    }
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    const body = JSON.parse(await read(request)) as Message | Message[]
    const replies = (Array.isArray(body) ? body : [body]).filter((message) => message.id !== undefined).map((message) => answer(message, path))
    if (!replies.length) return void response.writeHead(202).end()
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  Object.assign(fake, {
    url: `http://127.0.0.1:${port}/mcp`,
    origin: `http://127.0.0.1:${port}`,
    model,
    calls,
    called,
    inputs,
    markers,
    authorizations,
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  })
  return fake
}

const header = (request: IncomingMessage, name: string) => [request.headers[name]].flat()[0]

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}
