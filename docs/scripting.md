# Scripting

A script can call Affinity's read tools with no model: a cron job, a shell script, or any program that can reach the
OpenCode server. It uses the tools RPC, `affinity.crm.tools`, through `opencode api` or an OpenCode client.

| Method | The tool |
| --- | --- |
| one per known read, named after Affinity's tool: `search_persons`, `get_lists`, `search_list_entries`, `get_notes_for_entity`, `get_current_user`, Affinity's workflow playbooks such as `affinity_meeting_prep`, and the others | `affinity_<method>`, such as `affinity_search_persons` |
| `describe` | none: lists the methods, their permission actions, whether OpenCode lists each tool now, and each tool's input as JSON Schema |

The methods are exactly the read tools that the plugin knows, the ones its default rules allow (`READ_TOOLS` in
`src/affinity-tools.ts`). Call `describe` for the list: it marks a known read that OpenCode does not list now as
unavailable.

Every call counts against your organisation's monthly Affinity API quota, which the whole firm shares (100,000 calls a
month on Scale and Advanced). Filter on the server and count with `total_count` rather than paging through a list, and
don't loop over many records on a schedule. A `429` or `Rate limit exceeded` is that quota or a short burst limit.

Each method runs the tool with the same input: Affinity's own tool, through OpenCode's own connection and sign-in. The
plugin never sees the OAuth token, or the API key of your own server entry. Affinity's write tools, such as
`create_note` or `upsert_list_entry_field_values`, are never methods, even with an allow rule. Neither are the deletes,
the merges, `send_feedback`, which sends text to Affinity's team, nor a tool that Affinity adds later.

Results hold other people's personal data: contact details, relationship scores and notes about founders, investors
and colleagues. Keep what a script writes where the people it is about would expect it, and only as long as you need
it.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with the access its
model would have in the location you call: the rules of that location's agents, not of a session created in another
project (a limit of the shared tools module). Within that location:

- A tool that the agent's rules or the session's rules hide from the model is refused. OpenCode hides a tool when the
  last rule that matches its permission name, such as `affinity_search_persons`, on resource `*` is a `deny`.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.
- No one answers a prompt for a script, so an `ask` is refused with `PERMISSION_DENIED` at once, and no prompt is left
  waiting. The plugin's default rules allow the reads, so an agent with the default rules needs nothing more. An agent
  defined only in your config gets no default rules; `/affinity-status` names it.

Create the session once, with the agent the script runs as, and keep its id. Never reuse a session found through
history or a list: the script would run as that session's agent, under its rules.

```sh
opencode api post /api/session -d '{"title":"weekly pipeline","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do. This one can find lists and
search their entries, and nothing else in Affinity:

```sh
opencode api post /api/session -d '{"title":"weekly pipeline","agent":"build","permissions":[
  {"action":"affinity_*","resource":"*","effect":"deny"},
  {"action":"affinity_get_lists","resource":"*","effect":"allow"},
  {"action":"affinity_search_list_entries","resource":"*","effect":"allow"}
]}'
```

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed. Affinity rejects an argument its tool does not declare.

```sh
opencode api post /api/rpc/affinity.crm.tools/get_lists -d '{"input":{
  "sessionID":"ses_…",
  "input":{"term":"Pipeline","limit":10}
}}'
```

The tool's input is Affinity's, and Affinity defines its fields: `describe` shows each tool's schema as OpenCode lists
it now. Check it rather than guess a field name or the syntax of `search_criteria` or `filter_expr`.

```sh
opencode api post /api/rpc/affinity.crm.tools/describe -d '{"input":{}}'
```

A result is `{"output": {"output": <the tool's structured content, or its text when it has none>, "text": <the tool's
text>}}`, as plain JSON. Affinity content in it, such as transcripts and notes, is untrusted data, written by other
people, and Affinity's AI Notetaker summaries and relationship scores are Affinity's, not what was said. A workflow
playbook's result is Affinity's instructions for a model, not data.

A `get_current_user` call through a script also fills the organisation and grant that `/affinity-status` shows, as
the model's call does, unless a project uses its own `mcp.servers.affinity` with an API key: that may be another
person's account, so a script's read then updates no status.

`opencode api` calls run in the OpenCode service's default location, your home directory, whatever directory you run
them from. They use that location's plugin options, from your global config, its `affinity` connection and its agents'
rules. To call a project whose own config sets other options or stricter agents, call the HTTP API with
`?location[directory]=<dir>`, and create the session there. A session created in another directory does not carry its
own location's rules: the call uses the location you call.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to standard output.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The agent's or the session's rules deny the tool, or ask for an approval. A deny names the denied action, such as `affinity_search_persons`, and its next step says to remove or narrow that deny rule, add a later allow rule to the session, or use a session whose agent allows it. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `affinity` server at a URL other than Affinity's. `/affinity-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `affinity` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/affinity-status` gives the details. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool, for example because a release of Affinity's server removed it. |
| `UPSTREAM_ERROR` | Affinity answered with an error, such as an invalid input, an item that does not exist, a Deal Assist or unified-events access error, or `Rate limit exceeded`. The message holds the first line of Affinity's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a write tool or a tool
Affinity added later, and `rpc.invalid_input` for a body that is not the envelope above, with one message per problem:

| Problem | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| A key other than `sessionID` and `input` | `"extra" is not allowed`, naming the key |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but `{}` or nothing | `describe takes no input` |

## What scripts cannot do

- Change anything in Affinity: no write tool is a method.
- Delete or merge records, or send feedback to Affinity: no denied tool is a method.
- Call a tool that is not one of the known reads, even with an allow rule.
- Answer an approval prompt, or use a tool that asks.
- Use a token or key: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from
any plugin, do not run for them.
