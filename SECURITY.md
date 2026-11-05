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
  aimed at the model. OpenCode also lists Affinity's twelve playbooks as `/affinity:<name>` commands, and running one
  puts Affinity's playbook text in the session as the user's own message: the skills treat it as Affinity's text, so it
  never permits a change, a web search or another source unasked. Affinity's workflow playbooks return Affinity's own instructions for the model; the skills say
  their own rules win over that text, so a playbook never permits a change, a web search or another source unasked. The
  skills label Affinity's scores and AI Notetaker summaries as Affinity's.
- Every call, from the model or a script, counts against your organisation's monthly Affinity API quota, shared by the
  whole firm. The skills keep calls few.
- Ten tools are denied by default: the seven deletes and two merges, which remove CRM data for good, and
  `affinity_send_feedback`, which sends text to Affinity's team and which Affinity's own instructions tell the model to
  offer unasked. Turning them on takes `ask` rules in a dedicated agent's own `permissions`, so each call still asks, in
  that agent only.
- `affinity_issue_entity_files_download_token` returns a single-use download credential. It asks before it runs, and
  the skills tell the model to give it only to you, in chat.

## Permissions

What the model can do in Affinity is limited by these layers, in this order:

1. **Affinity's server and your access.** The sign-in is your own Affinity account, and you see what your Affinity
   permissions show. A sign-in with `mcp` (changes) unticked at consent is read-only: Affinity refuses every change.
   An Affinity admin decides whether OpenCode can sign in at all, and which scopes it may ask for, in Manage Apps.
2. **Default permission rules.** Every Affinity tool asks before it runs, except Affinity's read tools listed in
   `src/affinity-tools.ts`, which run without a prompt. Deletes, merges and `affinity_send_feedback` are denied. Every
   change that asks reaches the firm's shared CRM, which your colleagues see.
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
  tools may run there without asking. `/affinity-status` names these agents and gives the fix: put the default rules
  it shows first in that agent's own `permissions`, followed by your top-level rules for Affinity tools. Do not put
  them in the top-level `permissions`, which would loosen Explore.
- **Unattended runs refuse prompts.** In `opencode run`, an Affinity tool that would ask is refused.
- **The `affinity_*` rule also matches other servers** whose names start with `affinity_`. For their tools it only
  adds prompts.
- **The rules follow the name, not the server.** When your own `mcp.servers.affinity` points at another URL, status
  reports a conflict and the plugin adds no server, but the default rules still allow the known read names, so a tool
  of that server with such a name runs without asking. Point the entry at Affinity's URL, or remove it.

## Scripts

The tools RPC (`affinity.crm.tools`, see
[docs/scripting.md](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/scripting.md)) runs Affinity's
known read tools for a script, with no model. It adds no authority:

- A script names a session that names an agent, and runs as them. A tool that the agent's or the session's rules hide
  from the model is refused. OpenCode's own executor then checks the call against the agent's rules, the session's
  rules and saved approvals, as it does for the model.
- An ask on a script's call is denied, not prompted: no one is there to answer it. The plugin's permission hook
  changes only an ask on one of its own script calls in flight, only to a deny, and leaves every other call alone.
- Only the known reads are methods. Affinity's write tools never are, nor its deletes, merges or `send_feedback`, nor
  a tool that Affinity adds later, even with an allow rule.
- The call goes through OpenCode's own MCP connection and sign-in. The plugin never sees the token, and returns none.
- Affinity's error text reaches the script only as the first line, at most 300 characters, with tokens and URL query
  strings removed.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so
  another plugin's policy hook does not see it. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The
  session is not a login: it scopes a script to what its agent may do.
