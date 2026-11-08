# Configuration

Every option is optional. The smallest setup is one entry in `plugins`:

```json
{
  "plugins": ["@joe-broadhead/opencode-affinity"]
}
```

To set options, use the object form:

```json
{
  "plugins": [{ "package": "@joe-broadhead/opencode-affinity", "options": { "allowUntestedHost": true } }]
}
```

## Options

### `access`

- Type: `"all"`, `"ask-changes"` or `"read-only"`.
- Default: `"all"`.

How much the default rules restrict. `all` allows every Affinity tool; `ask-changes` allows a read and a playbook and
asks for every other tool; `read-only` allows a read and a playbook and denies every other tool, which also hides it
from the model. The classes come from `src/affinity-tools.ts`, so the value decides a tool Affinity adds later too.
[Permissions](#permissions) has the details and the generated blocks.

### `allowUntestedHost`

- Type: `true` or `false`.
- Default: `false`.

The plugin supports OpenCode `>=2.2.3 <2.3.0`, the range `opencode.host` in `package.json` declares, and every check
runs on 2.2.3, 2.2.4, 2.2.5 and 2.2.6, the tested releases. Status shows the version, whether it is tested and the supported
range in its `OpenCode` row, for example `2.2.5 (tested; supported range >=2.2.3 <2.3.0)`.

- **A tested release:** the plugin starts.
- **Another release inside the range, such as 2.2.99:** the plugin starts too. Status marks the version `untested`, and
  the status RPC's `host.tested` is `false`. The next step is the same as on a tested release.
- **Outside the range, including 2.3.0, prereleases and development builds:** the plugin refuses to start, and
  `/plugins` shows:

  ```text
  HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode >=2.2.3 <2.3.0, or set the plugin option "allowUntestedHost": true to run anyway.
  ```

- **Outside the range with `"allowUntestedHost": true`:** it starts anyway, and `/affinity-status` and `/affinity` show
  a warning.

There is no other option. To narrow what the model may do in Affinity, use permission rules, or a read-only sign-in;
see [Permissions](#permissions) and [Read-only for everyone](#read-only-for-everyone).

## Your own `mcp.servers.affinity`

If your config defines no server named `affinity`, the plugin registers one:

```json
{ "type": "remote", "url": "https://mcp.affinity.co/mcp", "oauth": { "scope": "mcp mcp.read offline_access" } }
```

The scope is the one Affinity's sign-in challenge asks for: changes (`mcp`), reads (`mcp.read`) and a refresh token
(`offline_access`). The plugin pins it, so a change to Affinity's challenge can't drop the refresh token. OpenCode signs
in with its own client metadata document, `https://opencode.ai/oauth/opencode/client.json`, which an Affinity admin
adds once per organisation (see the README's Organisation rollout). There is no client ID to set, and OpenCode's
defaults apply to everything else.

To change anything else, define `mcp.servers.affinity` yourself at Affinity's URL. The plugin then **adopts** your entry
unchanged, and `/affinity-status` shows "Connection: connected (…, your own mcp.servers.affinity, used unchanged)". The
permission rules and skills still apply. Of your entry the plugin reads only its type, its URL and whether `oauth` is
`false`; it never reads, copies or reports its `headers` or its `oauth` settings. An entry that signs in with OAuth
should keep `offline_access` in its `oauth.scope`: without it, Affinity issues no refresh token, and the sign-in expires
after a day.

An entry that sets `oauth.client_id` or `oauth.redirect_uri` stops OpenCode from using its client metadata document;
set them only for your organisation's own OAuth app, below.

### Read-only for everyone

Each person can untick `mcp` (changes) on Affinity's consent screen for a read-only connection, keeping
`offline_access`: without it, the sign-in expires after a day. To make read-only the default, or because your organisation allows OpenCode only the `mcp.read` scope (Affinity then refuses a sign-in that
asks for more, with `invalid_scope`), ask for the read scope alone:

```json
{
  "mcp": {
    "servers": {
      "affinity": {
        "type": "remote",
        "url": "https://mcp.affinity.co/mcp",
        "oauth": { "scope": "mcp.read offline_access" }
      }
    }
  }
}
```

Affinity then refuses every change with `Insufficient scope`, whatever the permission rules say, and the `Access` row
says "Affinity grant: read-only" after the first account read. The `/connect` entry stays. If you were signed in with
both scopes, sign out and sign in again. Run it from the project folder where the plugin is installed, or remove the account in `/connect` → **Affinity**. If it answers `MCP server not found: affinity`, OpenCode is still opening that folder: wait a few seconds and run it again.

### Your organisation's own OAuth app

An organisation that prefers its own app to OpenCode's client metadata document registers a public OAuth app in
Affinity (Settings, Manage Apps), with the redirect URI `http://127.0.0.1/callback`; Affinity accepts a loopback
redirect URI on any port, and OpenCode sends the port it listens on. Give members the app's client ID:

```json
{
  "mcp": {
    "servers": {
      "affinity": {
        "type": "remote",
        "url": "https://mcp.affinity.co/mcp",
        "oauth": { "client_id": "<the app's client ID>", "scope": "mcp mcp.read offline_access" }
      }
    }
  }
}
```

The `/connect` entry stays, and the sign-in works as before: OpenCode asks Affinity with the app's client ID instead of
its own, and sends `http://127.0.0.1:<port>/callback` as the redirect.

### With an Affinity API key

On a machine without a browser, you can sign in with a personal Affinity API key instead of OAuth. Create the key in
Affinity: Settings, Manage Apps, New App, API Key (you need the "Generate an API key" permission), and copy it at once:
Affinity shows it only once. Keep it in an environment variable, and define the server yourself:

```json
{
  "mcp": {
    "servers": {
      "affinity": {
        "type": "remote",
        "url": "https://mcp.affinity.co/mcp",
        "oauth": false,
        "headers": { "Authorization": "Bearer {env:AFFINITY_API_KEY}" }
      }
    }
  }
}
```

- Your entry wins: the plugin adopts it as written, and status shows "your own mcp.servers.affinity without OAuth".
- An entry with `"oauth": false` has no `/connect` entry: you sign in by changing the key.
- A key always has full access to everything you can reach in Affinity: it can't be made read-only, and the switches
  on Affinity's Settings → Affinity MCP page don't apply to it.
- OpenCode never refreshes or rotates the key. Revoking it in Manage Apps takes effect at once.
- Affinity keys are personal, so an organisation cannot set one for its members.

### A conflict

The plugin compares origin and path, so a trailing slash or a query string still matches. Any other URL, or a local
command, is a **conflict**: the plugin leaves your entry alone, adds nothing, status shows "Connection: conflict", and
gives the next step:

```text
- Next step: Your OpenCode config defines mcp.servers.affinity with https://affinity.example.com/mcp, but the plugin uses https://mcp.affinity.co/mcp. Point it at https://mcp.affinity.co/mcp or remove it, then restart OpenCode.
```

## Permissions

OpenCode asserts every MCP call itself, with the action `affinity_<tool>` and the resource `*`. The plugin adds its
block to every agent that starts with the base rule `{ "action": "*", "resource": "*", "effect": "allow" }`, directly
after that rule. The README prints the whole block for all three `access` values in
[Permissions](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/README.md#permissions); `/affinity-status`
prints the one in force, and its `Agents without default rules` row prints it as a list to paste.

`READ_TOOLS` in `src/affinity-tools.ts` lists Affinity's read tools, including its twelve workflow playbooks such as
`affinity_affinity_meeting_prep`, which return Affinity's instructions for a task as text. `WRITE_TOOLS` lists its
write tools, and `DESTRUCTIVE_TOOLS` the ten of the destructive class. A tool that Affinity adds later matches only
`affinity_*`, so it takes the value's own effect: allowed under `all`, asked about under `ask-changes`, denied under
`read-only`. `/affinity-status` names the tools in neither list. Affinity lists the same tools to everyone; your access
(Deal Assist, unified events, a read-only grant) shows as an error when a tool is called.

**Every tool is allowed by default**, so nothing is switched off for you. The destructive class deserves its own
sentences before you decide:

- the seven deletes remove CRM data for good. `affinity_delete_reminder` and
  `affinity_delete_list_field_dropdown_option` have no confirmation step in Affinity; the others first return a preview
  and change nothing until they are called again with `confirm: true`. Deleting a list entry on a deal list deletes the
  deal;
- the two merges delete the duplicate record, and a merge with a global company can't be undone;
- `affinity_send_feedback` sends text to Affinity's team, and Affinity's own server instructions tell the model to offer
  it whenever something can't be done.

### Restricting it

1. the `access` option, for the whole plugin;
2. the agent's own `permissions`, for one agent;
3. your top-level `permissions`, which OpenCode adds to every agent.

### `access`

| Value | What runs |
| --- | --- |
| `all` (the default) | every Affinity tool runs without a prompt |
| `ask-changes` | a read and a playbook run; every other tool asks, including one Affinity adds later |
| `read-only` | a read and a playbook run; every other tool is denied, and hidden from the model |

The value generates the block from the tool table's classes. A namespace rule (`affinity_*`) comes first, and each
known tool's own rule after it.

### A read-only agent

To restrict one agent, put the rules in that agent's own `permissions`; a top-level `ask` or `allow` would reach every
agent, Explore included. This agent reads, creates and updates notes, and asks before a delete or a merge:

```json
{
  "agents": {
    "crm-cleanup": {
      "description": "Affinity: reads and notes, every delete and merge asked first",
      "mode": "primary",
      "permissions": [
        { "action": "affinity_*", "resource": "*", "effect": "ask" },
        { "action": "affinity_get_current_user", "resource": "*", "effect": "allow" },
        { "action": "affinity_create_note", "resource": "*", "effect": "allow" },
        { "action": "affinity_update_note", "resource": "*", "effect": "allow" },
        { "action": "affinity_delete_company", "resource": "*", "effect": "ask" },
        { "action": "affinity_merge_companies", "resource": "*", "effect": "ask" }
      ]
    }
  }
}
```

To let that agent report a problem to Affinity, add `{ "action": "affinity_send_feedback", "resource": "*", "effect":
"ask" }` to the same agent's own `permissions`. In that agent, the model first calls a delete or merge without
`confirm`, shows you Affinity's warning, then makes the confirmed call; in that agent its permission prompt is your yes,
because the rule you added asks.

Don't put these rules in the top-level `permissions`: a top-level rule comes after every agent's own rules, so it would
reach every agent, Explore included, which otherwise can't use Affinity.

OpenCode uses the last rule that matches, so everything after the plugin's rules wins:

1. the agent's own rules, such as Explore's, which turn Affinity off there;
2. your top-level `permissions`, which OpenCode adds to every agent;
3. your saved "Always allow" answers, which beat an `ask` but never a configured `deny`.

A `deny` on resource `*` also hides the tool from the model. In an unattended run such as `opencode run`, a tool that
asks is refused. An agent without the base rule gets no Affinity rules and keeps its own behaviour.

### Recipes

A `deny` can go in the top-level `permissions` of `opencode.json`: it applies to every agent, and only tightens. An
`allow` or `ask` goes in the agent's own `permissions`: a top-level one would reach every agent, Explore included.

Never create fields or list dropdown options, which change every record of their type, in any agent (a `deny` also
hides the tools):

```json
[
  { "action": "affinity_create_field", "resource": "*", "effect": "deny" },
  { "action": "affinity_create_list_field_dropdown_option", "resource": "*", "effect": "deny" }
]
```

Make notes ask in the build agent even where your own rules would let them run: a note lands in the firm's shared CRM,
where every colleague who can see the record reads it, so it keeps its prompt.

```json
{
  "agents": {
    "build": {
      "permissions": [{ "action": "affinity_create_note", "resource": "*", "effect": "ask" }]
    }
  }
}
```

No recipe here makes a change run without a prompt. Answering "Always allow" at a prompt is the user's own choice in the
moment, and it applies to every agent in the project.

A strict agent where every Affinity tool asks, reads included: put these in that agent's own `permissions`, after the
block. The last match wins, so the `affinity_*` ask alone would turn the ten denied tools into asks too; repeating
their denies after it keeps them off:

```json
[
  { "action": "affinity_*", "resource": "*", "effect": "ask" },
  { "action": "affinity_delete_company", "resource": "*", "effect": "deny" },
  { "action": "affinity_delete_person", "resource": "*", "effect": "deny" },
  { "action": "affinity_delete_opportunity", "resource": "*", "effect": "deny" },
  { "action": "affinity_delete_note", "resource": "*", "effect": "deny" },
  { "action": "affinity_delete_list_entries", "resource": "*", "effect": "deny" },
  { "action": "affinity_delete_list_field_dropdown_option", "resource": "*", "effect": "deny" },
  { "action": "affinity_delete_reminder", "resource": "*", "effect": "deny" },
  { "action": "affinity_merge_companies", "resource": "*", "effect": "deny" },
  { "action": "affinity_merge_persons", "resource": "*", "effect": "deny" },
  { "action": "affinity_send_feedback", "resource": "*", "effect": "deny" }
]
```

### Agents that miss the rules

OpenCode creates agents that exist only in your config after plugins add their rules, so those agents get no Affinity
rules; agents that a later plugin adds are in the same position. An agent counts as guarded when the plugin's whole
block appears anywhere after its base allow. `/affinity-status` and `/affinity` list every other agent that has a base
allow and where a new Affinity tool would run without asking, by name, followed by the default rules to paste. The
next step reads:

```text
Put the default rules shown by /affinity-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Affinity tools.
```

Put the block first in that agent's own `permissions`, then repeat after it any top-level rules you have for
`affinity_*` tools, so yours keep winning. Never put the block in the top-level `permissions`: top-level rules come
after every agent's own rules, so it would loosen Explore. For an agent `reviewer`, with one top-level rule of your
own:

```json
{
  "permissions": [{ "action": "affinity_create_field", "resource": "*", "effect": "deny" }],
  "agents": {
    "reviewer": {
      "description": "Reviews changes",
      "mode": "subagent",
      "permissions": [
        { "action": "affinity_*", "resource": "*", "effect": "ask" },
        { "action": "affinity_get_current_user", "resource": "*", "effect": "allow" },
        "… the rest of the block from /affinity-status …",
        { "action": "affinity_create_field", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

Copy the full block from your own `/affinity-status` output; the lines in quotes above stand for it.

## Commands

| Command | What it does |
| --- | --- |
| `/affinity-status` | Posts the status report into the session. |
| `/affinity`, or "Affinity: Status" in the palette | Opens the same report in a dialog: `r` refreshes it, `Esc` closes it. |
| `/affinity:<name>` | One per workflow playbook Affinity serves as an MCP prompt, such as `/affinity:affinity-meeting-prep` and `/affinity:warm-intro`. A run is your request for that routine; the text it adds is Affinity's, so its steps are guidance, and any change still needs your own sentence and its own permission prompt. Affinity's text never permits a change, a web search or another source unasked. |

## Errors

Every error from the plugin reads `CODE: What happened. Next step: What to do.`

| Code | When | Next step |
| --- | --- | --- |
| `OPTIONS_INVALID` | Setup: an option is unknown or has a wrong value. `/plugins` shows the message, which names the option and the accepted values. | Fix the plugin options in `opencode.json`. |
| `HOST_UNTESTED` | Setup: OpenCode is outside `>=2.2.3 <2.3.0`, and `allowUntestedHost` is not set. | Use OpenCode `>=2.2.3 <2.3.0`, or set `"allowUntestedHost": true`. |
| `STATUS_UNAVAILABLE` | `/affinity-status`, `/affinity` or the status RPC: the status could not be read, or the plugin is not running on the server. The RPC answers with its error `unavailable`. | The message's own next step: restart OpenCode and run the command again, or, when the plugin is not running, run `/plugins` to see why. |
| `SKILLS_INVALID` | Setup: a skill file is missing or broken. The plugin still starts; status shows the problem. | Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | Setup: the `affinity` server could not be registered. Status shows the problem. | Restart OpenCode. |
| `RULES_NOT_ADDED` | Setup: the default permission rules could not be added, so Affinity tools may run without asking. Status shows the problem. | Restart OpenCode. |

For example:

```text
OPTIONS_INVALID: Unknown option "apiKey". Accepted options: "allowUntestedHost". Next step: Fix the plugin options in opencode.json, for example "plugins": [{ "package": "@joe-broadhead/opencode-affinity", "options": { "allowUntestedHost": true } }].
```

Errors from Affinity's server and from OpenCode pass through unchanged, such as `Insufficient scope` on a read-only
sign-in, the Deal Assist and unified-events access errors, `Rate limit exceeded`, and a delete's or merge's preview.
The tools RPC for scripts has its own codes, in [Scripting](scripting.md#errors).

## Status and RPC

`/affinity-status`, the `/affinity` dialog and the RPC method `status` (RPC ID `affinity.crm`) share one status
model. It holds no token, no header and no URL query, and makes no Affinity call. `version`, `host`, `state`,
`unguardedAgents` and `nextStep` are the fields every plugin of this family shares, with the same names and meanings:

| Field | Content |
| --- | --- |
| `version` | The plugin's version |
| `state` | `connected`, `sign_in_required`, `connecting`, `disabled`, `failed`, `not_configured` or `conflict`. The `Connection` row shows the same states as `connected`, `sign-in required`, `connecting`, `disabled`, `failed`, `not configured` and `conflict`. |
| `error` | For a failed connection only: OpenCode's reason, on one line of at most 160 characters, with any URL cut before its query. The text for a needed sign-in can hold an authorization URL, so it is never shown. |
| `source` | `type` (`plugin`, `adopted` or `conflict`), `url`, `signIn` (`oauth`, or `own` for your own entry with `"oauth": false`), and for a conflict the `expected` URL |
| `organisation` | The Affinity organisation's name, or `null` until the first `get_current_user` call since OpenCode started |
| `grant` | `read-write`, `read-only` (Affinity refuses every change), `api-key` (a personal key, with full access), or `null` until read |
| `adminStep` | While a sign-in is required and this server has not connected since OpenCode started: the advice for a first sign-in that Affinity may refuse, because the organisation has never added OpenCode's client URL (`https://opencode.ai/oauth/opencode/client.json`, under Settings, Manage Apps, New App, Client URL). It is advice, not a finding: OpenCode tells plugins nothing about a refused sign-in. A sign-in that worked earlier and now needs one again is a renewal, and the field is `null`. For your own `mcp.servers.affinity` entry, it also points at your organisation's own OAuth app, if that is what the entry uses. |
| `everConnected` | True once this `affinity` server has connected since OpenCode started |
| `access` | `all`, `ask-changes` or `read-only`: the value the default rules were generated for |
| `tools` | How many Affinity tools OpenCode lists that the plugin knows |
| `destructiveTools` | The listed tools of the destructive class, such as `send_feedback`. Under `all` they run like everything else, `ask-changes` asks for each, and `read-only` denies them. |
| `deniedTools` | The family field's old name; it carries the same list as `destructiveTools`. |
| `listing` | True while a server that connected moments ago lists no tools yet. The next step is then to run `/affinity-status` again in a few seconds. |
| `unknownCount`, `unknownTools` | How many of them the plugin does not know, and at most 20 of their names, only those made of lowercase letters, digits and `_` |
| `unguardedAgents` | Agents with a base allow and no block, under `ask-changes` or `read-only`; empty under `all`, and empty for an agent whose own rules already ask or deny for every Affinity tool. |
| `shadowedSkills` | Present only when a skill with one of the plugin's ids, such as your own `affinity` skill, replaces the plugin's: each `id` and the `path` OpenCode loads instead |
| `host` | `version` (`null` if OpenCode reports none), `range` (the supported range) and `tested` (true only for 2.2.3, 2.2.4, 2.2.5 and 2.2.6) |
| `problems` | Setup problems, each `CODE: What happened. Next step: What to do.` |
| `nextStep` | Exactly one next step: the `Next step` row, `Nothing to do.` when nothing is needed |

The `Organisation setup` row shows `adminStep` while a sign-in is required and nothing has connected yet:
"If this is the first sign-in here, an Affinity admin must first add OpenCode's client URL." After a sign-in that
worked, a later one is a renewal, and the row says so instead.

The organisation and the grant come from `tenant.name`, `grant.type` and `grant.scopes` of a `get_current_user` result,
made by the model or by a script, and are kept in memory only. Of the scopes, only `mcp`, `mcp.read`, `api` and
`api.read` are read. Nothing else of the result is read: not your name, email or ids, and not the organisation's id or
subdomain. They are forgotten when the server is no longer connected, or the account is switched.

When the status cannot be read, the method answers with its error `unavailable`: the message
`STATUS_UNAVAILABLE: Could not read Affinity's status (…).` and `data: { nextStep }`.
