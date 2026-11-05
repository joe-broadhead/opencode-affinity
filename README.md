# Affinity for OpenCode

Find, read and update your firm's Affinity CRM (companies, people, deals, notes and relationships) from OpenCode,
through Affinity's official MCP server.

Unofficial; not affiliated with Affinity.

## Requirements

- OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4 and 2.2.5. Outside that range the plugin does not start, unless
  you set `allowUntestedHost`.
- macOS or Linux.
- An Affinity CRM account on the **Scale, Advanced or Enterprise** plan, which include API and MCP access.
- **Once per Affinity organisation**, an Affinity admin adds OpenCode as an app: Settings → Manage Apps → New App →
  **Client URL**, with `https://opencode.ai/oauth/opencode/client.json` (see
  [Organisation rollout](#organisation-rollout)). If that menu item is missing, ask your Affinity contact to turn it
  on. Until then Affinity shows an error page instead of asking for access.
- What you can see follows your Affinity permissions. Note and file search need **Deal Assist**, and the meeting tools
  need **unified events**; ask your Affinity admin.
- Every call counts against your organisation's monthly Affinity API quota, which the whole firm shares (100,000 calls a
  month on Scale and Advanced).
- Affinity hosts its data in the United States.

## Install

```sh
opencode plugin add @joe-broadhead/opencode-affinity
```

Run `opencode reload`, or restart OpenCode. Then run `/affinity-status`: it shows `sign-in required` until you sign in
(see [Sign in](#sign-in)).

The plugin registers Affinity's MCP server under the name `affinity`, adds default permission rules, the
`/affinity-status` command, the `/affinity` status view and two skills. Every tool is Affinity's, and OpenCode handles
the connection, the sign-in and the stored credentials.

**Update** with `opencode plugin update @joe-broadhead/opencode-affinity`, then run `opencode reload`. An entry pinned
to a version does not update: remove the `@version` from its `plugins` entry first.

## Sign in

Run `/connect` and choose **Affinity** (it is listed under MCP). In the terminal UI, press `o` or Enter to open the link
to Affinity's sign-in page in your browser, choose your organisation and sign in. No key is needed.

From a terminal, run `opencode mcp auth affinity` instead; it opens the link automatically. `/mcps` also offers the
same sign-in.

Affinity's consent screen lists three scopes, all ticked. **Untick the first one for a read-only connection**: reads
work, and Affinity refuses every change. Sign in again with it ticked to allow changes.

If Affinity shows an error page instead of the consent screen, your organisation has not added OpenCode yet: ask an
Affinity admin to follow [Organisation rollout](#organisation-rollout). OpenCode's sign-in waits for an answer that
never comes; close it after the admin step, and sign in again.

When the sign-in expires and cannot be renewed, `/connect` marks the Affinity account as needing a new sign-in, and
OpenCode shows its "MCP server needs authentication" notice.

To sign out, or to switch account or organisation, run `opencode mcp logout affinity`, or remove the account in
`/connect` → Affinity. Then sign in again. To sign out before you remove the plugin, see [Uninstall](#uninstall).

On a machine without a browser, you can use an Affinity API key in your own server entry instead; see
[Configure](#configure).

## Use

Ask, for example:

- "Prep me for my meeting with Acme Robotics tomorrow."
- "Who at our firm knows Jane Doe best?"
- "Which deals in our pipeline have had no activity for 30 days, by stage?"
- "Summarise our notes on Northwind Capital this quarter."
- "Move Acme Robotics to Due Diligence." (asks first)

Contact details, relationship scores and inferred connections are other people's personal data: the model reads them
only for your question, labels Affinity's scores and AI Notetaker summaries as Affinity's, and keeps CRM data out of
other tools unless you name the destination. It keeps calls few, because they count against the firm's quota.

| Command | What it does |
| --- | --- |
| `/affinity-status` | Posts the status report into the session: connection, account, access, organisation setup, tools, agents without the default rules, the OpenCode check and the next step. The model can read it too. |
| `/affinity`, or "Affinity: Status" in the command palette | Opens the same report in a dialog. Press `r` to refresh it and `Esc` to close it. It also refreshes when Affinity's connection, the sign-in or the agents change. |

The organisation and the grant in the report appear after the model's first account read (`affinity_get_current_user`)
since OpenCode started; the plugin makes no Affinity call of its own.

Two skills teach the model to use Affinity well:

- `affinity`: finding companies, people and deals, lists and pipelines, relationship strengths and inferred paths,
  notes, meetings and transcripts, Affinity's own workflow playbooks (whose text never overrides the skill's rules),
  the quota, and the rules for other people's data.
- `affinity-write`: whom each change reaches (the whole firm's CRM, a colleague, everyone in the organisation), reading
  first, the updates that replace a whole set, saying what a change does before the call, and leaving the yes to
  OpenCode's permission prompt.

### Scripts

A script or a cron job can call Affinity's read tools with no model, through `opencode api`. It runs as a session and
its agent, under that agent's permission rules and the session's own. Write tools are never available to scripts, and
every call counts against the firm's quota:

```sh
opencode api post /api/rpc/affinity.crm.tools/get_lists \
  -d '{"input":{"sessionID":"ses_…","input":{"term":"Pipeline"}}}'
```

See [Scripting](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/scripting.md).

## Permissions

The plugin adds these rules to every agent, directly after the agent's base rule that allows everything:

1. `{ "action": "affinity_*", "resource": "*", "effect": "ask" }`: every Affinity tool asks, including tools Affinity
   adds later.
2. One `allow` rule for each of Affinity's read tools, Affinity's workflow playbooks included, listed in
   [`src/affinity-tools.ts`](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/src/affinity-tools.ts).
   These run without a prompt.
3. Ten `deny` rules, for tools that are off until you turn them on. A deny also hides the tool from the model.
   - Seven deletes, which remove CRM data for good. Two have no confirmation step in Affinity.
     - `{ "action": "affinity_delete_company", "resource": "*", "effect": "deny" }`
     - `{ "action": "affinity_delete_person", "resource": "*", "effect": "deny" }`
     - `{ "action": "affinity_delete_opportunity", "resource": "*", "effect": "deny" }`
     - `{ "action": "affinity_delete_note", "resource": "*", "effect": "deny" }`
     - `{ "action": "affinity_delete_list_entries", "resource": "*", "effect": "deny" }`
     - `{ "action": "affinity_delete_list_field_dropdown_option", "resource": "*", "effect": "deny" }`
     - `{ "action": "affinity_delete_reminder", "resource": "*", "effect": "deny" }`
   - Two merges, which delete the duplicate; a merge with a global company can't be undone.
     - `{ "action": "affinity_merge_companies", "resource": "*", "effect": "deny" }`
     - `{ "action": "affinity_merge_persons", "resource": "*", "effect": "deny" }`
   - `{ "action": "affinity_send_feedback", "resource": "*", "effect": "deny" }`: sends text to Affinity's team, and
     Affinity's own instructions tell the model to offer it whenever something can't be done.

   To turn them on, use a dedicated agent whose own `permissions` make them **ask**, as
   [Configuration](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/configuration.md#a-clean-up-agent-for-deletes-and-merges)
   shows. Not in the top-level `permissions`: a top-level rule reaches every agent, Explore included. Never make them
   `allow`, and don't answer "Always allow" for them.

So reads run, every change asks before it runs, and the ten above don't run at all. Each change reaches the firm's
shared CRM, which your colleagues see. Everything that comes later than these rules still wins: an agent's own stricter
rules (Explore cannot use Affinity), your `permissions` in `opencode.json`, and your saved "Always allow" answers. In an
unattended run such as `opencode run`, a tool that asks is refused.

Agents that exist only in your own config, and agents added by plugins that load later, are created after the plugin
adds its rules, so Affinity tools run there without asking. `/affinity-status` and `/affinity` name those agents and
show the default rules to put first in each one's own `permissions`. Do not put them in the top-level `permissions`,
which would loosen Explore.
[Configuration](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/configuration.md#permissions) has a
worked example and permission recipes.

## Configure

Set options with the object form of the plugin entry:

```json
{
  "plugins": [{ "package": "@joe-broadhead/opencode-affinity", "options": { "allowUntestedHost": true } }]
}
```

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `allowUntestedHost` | `true` or `false` | `false` | Starts on an OpenCode version outside `>=2.2.3 <2.3.0`, with a warning in status. |

[docs/configuration.md](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/configuration.md) has the
details, including your own `mcp.servers.affinity` entry (a read-only sign-in for everyone, your organisation's own
OAuth app, or an Affinity API key), permission recipes and every error.

## Organisation rollout

OpenCode signs in to Affinity with its own client metadata document, so there is no client ID to distribute. Affinity
accepts it only after an admin of your Affinity organisation, with permission to manage OAuth apps, adds it once:

1. In Affinity, open Settings → Manage Apps → **New App** → **Client URL**.
2. Paste `https://opencode.ai/oauth/opencode/client.json`, and choose **Preview**.
3. Allow the scopes `mcp`, `mcp.read` and `offline_access`, and choose **Add App**. Allowing only `mcp.read` makes every
   member's connection read-only; members then need the read-only entry in
   [Configuration](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/configuration.md#read-only-for-everyone),
   or Affinity refuses their sign-in with `invalid_scope`.

Revoking that app in Manage Apps disconnects every member's OpenCode at once. Affinity's Settings → Affinity MCP page
lists only Affinity's built-in clients, not OpenCode.

Then put the plugin entry in the system config: `/Library/Application Support/opencode/opencode.json` on macOS, or
`/etc/opencode/opencode.json` on Linux. This example also turns off two changes for everyone: new fields and new list
dropdown options, which change every record of their type:

```json
{
  "plugins": ["@joe-broadhead/opencode-affinity"],
  "permissions": [
    { "action": "affinity_create_field", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_list_field_dropdown_option", "resource": "*", "effect": "deny" }
  ]
}
```

Members then only sign in: run `/connect` and choose Affinity, then press `o` or Enter to open the link. An organisation
that prefers its own OAuth app can register one and give members its client ID; see Configuration. Affinity API keys
are personal, so an organisation cannot set one for its members. Affinity's terms bar using Affinity data to train AI
models; check your firm's AI policy before you turn this on.

## Troubleshooting

Run `/affinity-status` first. Its last line is the next step.

| Status or error | What to do |
| --- | --- |
| Connection: sign-in required | Run `/connect` and choose Affinity, then press `o` or Enter to open the link. In a terminal, `opencode mcp auth affinity` opens it automatically. |
| `CLIENT_NOT_ALLOWED` (Organisation setup row): Affinity shows an error page instead of asking for access | Your Affinity organisation has not added OpenCode yet, and OpenCode's sign-in waits without an answer. Ask an Affinity admin to add `https://opencode.ai/oauth/opencode/client.json` under Settings → Manage Apps → New App → Client URL, as [Organisation rollout](#organisation-rollout) shows, then sign in again. |
| The sign-in fails with `invalid_scope` | Your organisation allows OpenCode only the read-only scope. Use the read-only entry in Configuration, or ask the admin to allow `mcp` too. |
| Connection: connecting | Wait a few seconds, then run `/affinity-status` again. |
| Connection: failed | Check your network, then run `/affinity-status` again. With your own entry that sends an API key, check the key (Affinity: Settings, Manage Apps). |
| Connection: disabled | Enable `affinity` in `/mcps`, or remove `"disabled": true` from `mcp.servers.affinity` in `opencode.json`. |
| Connection: not configured | An organisation policy (`mcp.use`) or another plugin removes the `affinity` server. Ask your administrator, then restart OpenCode. |
| Connection: conflict | Your config has an `mcp.servers.affinity` entry with a URL other than `https://mcp.affinity.co/mcp`. Point it at `https://mcp.affinity.co/mcp` or remove it, then restart OpenCode. |
| Tools: none listed yet | Affinity connected moments ago and is still listing its tools. Run `/affinity-status` again, or press `r` in the dialog, in a few seconds. |
| Tools: off by default | The tools the default rules deny, listed by name. See [Permissions](#permissions) to turn them on, as an ask, in one agent. |
| Tools: unknown | Affinity added tools the plugin does not know yet. They ask before they run. |
| Access: default rules missing or not added | Some agents lack the default rules (see the agents row), or OpenCode could not add them (see the OpenCode row). Follow the next step. |
| Access: Affinity grant: read-only | You unticked the first scope at sign-in, so Affinity refuses changes with `Insufficient scope`. To allow changes, sign out (`opencode mcp logout affinity`) and sign in again with it ticked. |
| Note or file search returns an error about Deal Assist | Your organisation doesn't have Deal Assist. Ask your Affinity admin; other reads still work. |
| Meetings return an access error about unified events | Your organisation hasn't finished Affinity's unified events onboarding. Ask your Affinity admin. |
| `429` or `Rate limit exceeded` | Your organisation's monthly API quota, or a short burst limit, is used up. Affinity shows usage in Settings; the quota is shared by the whole firm. |
| An answer misses records a colleague can see | Results follow your own Affinity permissions. Ask the colleague or an Affinity admin. |
| Agents without default rules | Put the default rules shown by `/affinity-status` first in each listed agent's own permissions, in `opencode.json` or the agent's Markdown file, followed by your top-level rules for Affinity tools. |
| OpenCode: untested | OpenCode is not 2.2.3, 2.2.4 or 2.2.5. Inside `>=2.2.3 <2.3.0` the plugin runs normally; outside it, it runs only because `allowUntestedHost` is set. If Affinity misbehaves, use a tested release. |
| Signed in to the wrong Affinity organisation | Run `opencode mcp logout affinity` (or remove the account in `/connect` → Affinity), then sign in again and choose the other organisation. |
| An Affinity tool is refused in `opencode run` | Nobody could answer its prompt. Add an `allow` rule for that read or write to the agent's own `permissions` (never for a delete, a merge or `affinity_send_feedback`: run those interactively). |
| A skill seems ignored, and status names a skill to rename or move | A skill of yours with the same id, such as `affinity`, replaces the plugin's. Rename or move it. |
| `/affinity` is missing | The plugin did not start. Run `/plugins` to see the error. |
| `OPTIONS_INVALID` | An option is unknown or has a wrong value. The message names the option and the accepted values. |
| `HOST_UNTESTED` | Your OpenCode is outside `>=2.2.3 <2.3.0`, so the plugin did not start. Use OpenCode `>=2.2.3 <2.3.0`, or set `"allowUntestedHost": true` to run anyway. |
| `STATUS_UNAVAILABLE` | The status could not be read, or the plugin is not running. Follow the next step in the message. |
| `SKILLS_INVALID` | A skill file in the package is missing or broken. Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | The plugin could not register the `affinity` server. Restart OpenCode. |
| `RULES_NOT_ADDED` | The default permission rules could not be added, so Affinity tools may run without asking. Restart OpenCode. |

A script's errors from the tools RPC have their own codes, listed in
[Scripting](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/scripting.md#errors).

## Uninstall

Sign out while the plugin is still installed: once it is removed, OpenCode no longer knows the `affinity` server, so
`opencode mcp logout affinity` fails with `MCP server not found: affinity` and the sign-in stays in OpenCode's
credential store.

1. Sign out: `opencode mcp logout affinity`. Right after OpenCode starts or reloads, it can answer
   `MCP server not found: affinity` for a few seconds; wait, then run it again.
2. Check: `opencode auth list` no longer lists **Affinity**.
3. Remove the plugin: `opencode plugin remove @joe-broadhead/opencode-affinity`, then `opencode reload`.
   `opencode mcp list` no longer lists `affinity`.
4. Remove any Affinity rules you copied into your agents' own `permissions`. If you used an API key, revoke it in
   Affinity: Settings, Manage Apps. An admin who no longer wants OpenCode for anyone revokes its app there, which
   disconnects every member.

## Links

- [Configuration](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/configuration.md)
- [Scripting](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/scripting.md)
- [In Jelly](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/jelly.md)
- [Architecture](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/architecture.md)
- [Contributing](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/CONTRIBUTING.md)
- [Security](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/SECURITY.md)
- [Changelog](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/CHANGELOG.md)
- [MIT license](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/LICENSE)
- [Affinity's MCP server](https://support.affinity.co/s/article/Getting-started-with-Affinity-MCP)
