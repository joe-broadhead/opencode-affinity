# Security

## Supported versions

Fixes go into the newest release. Older releases are not patched.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue. Include the plugin version, the OpenCode
version, your plugin options and the steps to reproduce. Never include tokens, API keys, CRM records or other
Affinity content.

Vulnerabilities in Affinity's service or in OpenCode itself are out of scope. Report those to Affinity or to the
OpenCode project.

## Data handling

- The plugin holds no credential and runs no network request of its own. It registers Affinity's MCP server with
  OpenCode, and OpenCode connects, signs in and stores the credentials. The tools RPC for scripts (see
  [Scripts](#scripts)) runs Affinity's tools through OpenCode's own connection, too.
- The plugin never reads tokens. Of a user's own `mcp.servers.affinity` entry it reads only the type, the URL and
  whether `oauth` is `false`; it never reads, copies or reports its `headers`, where an API key may be. Status shows
  server URLs without their query strings, never OpenCode's text for a needed sign-in, which can hold an authorization
  URL, and cuts a connection failure's reason to one line with no URL query.
- The account capture keeps the organisation's name and the grant's scopes from a `get_current_user` result in
  memory only. It never reads your name, email or ids, or the organisation's id or subdomain, and forgets both when the
  server is no longer connected, or the account is switched. The plugin never calls Affinity itself.
- **The CRM holds other people's personal data.** Contact details, relationship scores and inferred connections of
  founders, investors and colleagues, notes, meeting attendees and transcripts reach the model as tool results, and the
  agent sends them to your model provider, like any other tool result in the session. The skills tell the model to read
  them only for the question asked, to profile no one, and to send CRM data to no other tool unless you name it.
  Affinity's terms bar using Affinity data to train AI models; your firm's own AI policy applies.
- Affinity content is untrusted. Notes, transcripts and records come from other people and can contain instructions
  aimed at the model. Affinity's twelve workflow playbooks return Affinity's own instructions, and OpenCode lists them
  as `/affinity:<name>` commands: a run is your request for that routine, but the text it adds is Affinity's, so its
  steps are guidance, and the skills still permit no change, web search or other source that you did not ask for. The
  skills label Affinity's scores and AI Notetaker summaries as Affinity's.
- Every call, from the model or a script, counts against your organisation's monthly Affinity API quota, shared by the
  whole firm. The skills keep calls few.
- **Every Affinity tool is allowed by default**, so an agent can create a note, rewrite a deal's field values, merge two
  companies, or delete a reminder without a prompt, and every one of those changes the firm's shared CRM that your
  colleagues see. The seven deletes remove data for good, and two merges cannot be undone.
- **One line restricts it.** Set `"access": "ask-changes"` in the plugin options and every change asks first, or
  `"read-only"` and every change is denied. A rule in an agent's own `permissions` restricts one agent, and a `deny` in
  the top-level `permissions` restricts every agent. The README's
  [Permissions](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/README.md#permissions) has the three blocks.
- Ten tools are of the destructive class: the seven deletes and two merges, which remove CRM data for good, and
  `affinity_send_feedback`, which sends text to Affinity's team and which Affinity's own instructions tell the model to
  offer unasked. `ask-changes` asks for each; `read-only` denies them; a `deny` in an agent's own `permissions` narrows
  further.
- `affinity_issue_entity_files_download_token` returns a single-use download credential. Under the default it runs
  without a prompt; the skills tell the model to give it only to you, in chat.

## Permissions

What the model can do in Affinity is limited by these layers, in this order:

1. **Affinity's server and your access.** The sign-in is your own Affinity account, and you see what your Affinity
   permissions show. A sign-in with `mcp` (changes) unticked at consent is read-only: Affinity refuses every change.
   An Affinity admin decides whether OpenCode can sign in at all, and which scopes it may ask for, in Manage Apps.
2. **Default permission rules.** The plugin inserts one block generated from the tool table and the `access` option.
   Its default, `all`, allows every Affinity tool, reads, playbooks and changes alike, and every change reaches the
   firm's shared CRM. `ask-changes` allows a read and a playbook and asks for everything else; `read-only` allows a read
   and a playbook and denies everything else, which also hides it from the model.
3. **Your OpenCode permissions.** Your `permissions` rules and saved "Always allow" answers override the default
   rules. A `deny` you configure always wins.

Things to know:

- **Saved approvals are broad.** "Always allow" on an Affinity tool saves the pattern `*` for that tool's action. It
  applies to every agent in the OpenCode project, Plan included, until you remove it. Think twice before saving one
  for a tool that changes the firm's CRM. OpenCode identifies a project by its git repository. A folder outside
  any git repository with a commit may belong to OpenCode's shared `global` project, so an approval saved there may
  apply in other such folders too.
- **Some agents get no default rules.** Agents defined only in your own config, and agents added by plugins that load
  after this one, are created after the plugin inserts its rules, and agents without a base allow get none. Affinity
  tools may run there with no block at all. Under the default `access: "all"` that changes nothing; under `ask-changes`
  or `read-only` those agents stay unrestricted. `/affinity-status` names them and gives the fix: put the block it shows
  first in that agent's own `permissions`, followed by your top-level rules for Affinity tools. Do not put an `ask` or
  an `allow` in the top-level `permissions`, which would loosen Explore.
- **Unattended runs refuse prompts.** In `opencode run`, an Affinity tool that would ask is refused.
- **The `affinity_*` rule also matches other servers** whose names start with `affinity_`. For their tools it only
  adds prompts.
- **The rules follow the name, not the server.** When your own `mcp.servers.affinity` points at another URL, status
  reports a conflict and the plugin adds no server, but the default rules still allow the known read names, so a tool
  of that server with such a name runs without asking. Point the entry at Affinity's URL, or remove it.

## Scripts

The tools RPC (`affinity.crm.tools`, see
[docs/scripting.md](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/scripting.md)) exposes every
known Affinity tool as a method for a script, with no model, each with a class: read (the workflow playbooks too),
write or destructive. It adds no authority:

- A script names a session that names an agent, and runs as them. The rules that decide are the agent's, then the
  session's, resolved before dispatch: only `allow` runs. An `ask` is refused with no prompt and no Affinity call, and a
  `deny` is refused with no Affinity call. A saved "Always allow" is not part of those rules and does not authorise a
  script; a script's grant is a rule in config, or a Jobs run session.
- A script gets the same default: under `access: "all"` the block allows every method, so a script can change the
  firm's CRM with no further rule. Restrict the session's agent, or the session's own rules, to narrow that; with
  `ask-changes` or `read-only` a script needs an explicit `allow` for a change, and an `ask` is refused because no one
  is there.
- OpenCode's own executor still checks an MCP call against the agent's rules, the session's rules and saved approvals.
- An inner ask on a script's call is denied, not prompted. The plugin's permission hook changes only an ask on one of
  its own script calls in flight, only to a deny, and leaves every other call alone.
- A tool that Affinity adds later is not a method, even with an allow rule; `describe` reports it as unclassified.
- The call goes through OpenCode's own MCP connection and sign-in. The plugin never sees the token, and returns none.
- Affinity's error text reaches the script only as the first line, at most 300 characters, with tokens and URL query
  strings removed.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so
  another plugin's policy hook does not see it. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The
  session is not a login: it scopes a script to what its agent may do.
