# Scripting

A script can call Affinity's tools with no model: a cron job, a shell script, or any program that can reach the
OpenCode server. It uses the tools RPC, `affinity.crm.tools`, through `opencode api` or an OpenCode client.

Every tool the plugin knows is a method, named after Affinity's tool, without the `affinity_` prefix. Each method
carries a class: the worst thing that tool can do.

| Class | Methods | What the class means |
| --- | --- | --- |
| `read` | one per known read: `search_persons`, `get_lists`, `search_list_entries`, `get_notes_for_entity`, `get_current_user` and the others | it only reads |
| `read` | Affinity's twelve workflow playbooks too, such as `affinity_meeting_prep`, `warm_intro` and `crm_audit` | each only returns text; what it can drive is the caller's own decision, under the caller's rules |
| `write` | the twenty writes, such as `create_note`, `create_person`, `update_person` and `upsert_list_entry_field_values` | it changes the firm's shared CRM, or issues a file credential |
| `destructive` | `delete_company`, `delete_person`, `delete_opportunity`, `delete_note`, `delete_list_entries`, `delete_list_field_dropdown_option`, `delete_reminder`, `merge_companies`, `merge_persons`, `send_feedback` | removes CRM data for good, or sends text to Affinity's team |
| `describe` | none: lists the methods, their class, their permission action, whether OpenCode lists each tool now, each tool's input as JSON Schema, and — given a session — whether that session may call it |

The methods come from the plugin's one tool table, `src/affinity-tools.ts`: the known reads (`READ_TOOLS` in
`src/affinity-tools.ts`), the workflow playbooks in `WORKFLOW_TOOLS`, the writes in `WRITE_TOOLS`, and the ten denied
tools in `DENIED_TOOLS`. Call `describe` for the list: it marks a known tool that OpenCode does not list now as
unavailable.

The class is never the decision: the rules are. A `write` and a `destructive` method are methods too, and they run
whenever the session's rules resolve them to `allow` — which the default `access: "all"` does, for every method. That
is the family default, and it means a script can change the firm's shared CRM: restrict the session's agent, or the
session's own rules, before you schedule one. The class decides what `access: "ask-changes"` and `"read-only"`
restrict, and `describe` reports it beside the resolved permission.

Every call counts against your organisation's monthly Affinity API quota, which the whole firm shares (100,000 calls a
month on Scale and Advanced). Filter on the server and count with `total_count` rather than paging through a list, and
don't loop over many records on a schedule. A `429` or `Rate limit exceeded` is that quota or a short burst limit.

Each method runs the tool with the same input: Affinity's own tool, through OpenCode's own connection and sign-in. The
plugin never sees the OAuth token, or the API key of your own server entry. A tool that Affinity adds later is not a
method, even with an allow rule; `describe` reports it as unclassified.

Results hold other people's personal data: contact details, relationship scores and notes about founders, investors
and colleagues. Keep what a script writes where the people it is about would expect it, and only as long as you need
it.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with the access its
model would have in the location you call: the rules of that location's agents, not of a session created in another
project. Within that location, the rules are resolved before dispatch:

- **Only an `allow` runs.** An `ask` is refused with no prompt and no Affinity call, because no one is there to answer
  it. A `deny` is refused with no Affinity call. The last rule that matches an action wins, and the agent's rules come
  first, then the session's.
- **A saved approval does not authorise a script.** An earlier "Always allow" is not part of the agent's and the
  session's rules, so a script that relied on one now needs an `allow` for its action in the session's or the agent's
  rules. This is deliberate; it keeps a script's grant reviewable rather than in a list of past clicks.
- The plugin's default rules allow the reads and the playbooks, so an agent with the default rules needs nothing more.
  An agent defined only in your config gets no default rules; `/affinity-status` names it.

Create the session once, with the agent the script runs as, and keep its id. Never reuse a session found through
history or a list: the script would run as that session's agent, under its rules.

Give the project as the session's `location`: a session made without one belongs to the service's default location, where the project's agents may not exist, and each call then fails `Agent not found`.

```sh
opencode api post /api/session -d '{"title":"weekly pipeline","agent":"build","location":{"directory":"/path/to/project"}}'
```

Session rules come after the agent's, so a session can narrow what its script may do. This one can find lists and
search their entries, and nothing else in Affinity:

```sh
opencode api post /api/session -d '{"title":"weekly pipeline","agent":"build","location":{"directory":"/path/to/project"},"permissions":[
  {"action":"affinity_*","resource":"*","effect":"deny"},
  {"action":"affinity_get_lists","resource":"*","effect":"allow"},
  {"action":"affinity_search_list_entries","resource":"*","effect":"allow"}
]}'
```

`describe` with the session reports the resolved permission of every method, so a script can check before it calls.
A session created in another directory does not carry its own location's rules: the call uses the location you call.

For a one-off script with an approval bound to it, use Jobs' `jobs_run_script`: the approval covers exactly that
source and that list of methods, and Jobs writes the run session's rules for you.

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed. Affinity rejects an argument its tool does not declare.

```sh
opencode api post /api/rpc/affinity.crm.tools/get_lists -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "input":{"term":"Pipeline","limit":10}
}}'
```

The tool's input is Affinity's, and Affinity defines its fields: `describe` shows each tool's schema as OpenCode lists
it now. Check it rather than guess a field name or the syntax of `search_criteria` or `filter_expr`.

```sh
opencode api post /api/rpc/affinity.crm.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/affinity.crm.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

With a session, each method in the answer also carries `permission`: `allow`, `ask` or `deny`, resolved exactly as a
call would be. The answer also carries `location`, and `unclassified` when Affinity lists a tool the plugin's table
does not classify.

A result comes back as `{ output?, text }`: the tool's structured content when it has any, and its text parts
joined by newlines. Affinity content in it, such as transcripts and notes, is untrusted data, written by other
people, and Affinity's AI Notetaker summaries and relationship scores are Affinity's, not what was said. A workflow
playbook's result is Affinity's instructions for a model, not data.

A `get_current_user` call through a script also fills the organisation and grant that `/affinity-status` shows, as
the model's call does, unless a project uses its own `mcp.servers.affinity` with an API key: that may be another
person's account, so a script's read then updates no status.

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:

```sh
opencode api post /api/rpc/affinity.crm.tools/<method> -H "x-opencode-directory:$PWD" -d '{…}'
```

Without it the call goes to the service's default location and fails `rpc.unavailable` if the plugin is not loaded
there. The HTTP equivalents are the `location[directory]` query parameter and the same header. `describe` reports the
`location` that answered and a `locationHint`.

A location unloads after OpenCode's idle timeout. If a scheduled script gets `rpc.unavailable` from a location that was
loaded before, send the call again once: the request loads the location. Jobs keeps its own location loaded.


## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to standard output.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. The next step names the `x-opencode-directory` header. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The last matching rule is an `ask` or a `deny`, so the call was refused before dispatch. An ask says that a script cannot answer and names the allow rule to add; a deny names the denied action, such as `affinity_search_persons`, and says to remove or narrow that rule, add a later allow to the session, or use a session whose agent allows it. A saved "Always allow" does not help. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `affinity` server at a URL other than Affinity's. `/affinity-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `affinity` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/affinity-status` gives the details. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool, for example because a release of Affinity's server removed it. |
| `UPSTREAM_ERROR` | Affinity answered with an error, such as an invalid input, an item that does not exist, a Deal Assist or unified-events access error, or `Rate limit exceeded`. The message holds the first line of Affinity's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a tool Affinity added later,
and `rpc.invalid_input` for a body that is not the envelope above, with one message per problem:

| Problem | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| A key other than `sessionID` and `input` | `"extra" is not allowed`, naming the key |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but nothing, `{}` or `{"sessionID":"…"}` | `describe takes nothing, or {"sessionID":"<session>"}` |

## What scripts cannot do

- Run a method whose action resolves to `ask` or `deny`: no one can answer a prompt, and a deny needs its rule changed.
- Rely on a saved "Always allow" from the model path: a script needs an `allow` rule in config, or a Jobs one-off's
  approval.
- Call a tool that is not in the plugin's table, even with an allow rule. It is reported as `unclassified`.
- Use a token or key: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from
any plugin, do not run for them. The plugin applies the same result shaping it applies on the model path: a
`get_current_user` result fills the account status either way.
