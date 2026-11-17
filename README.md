# Affinity for OpenCode

Find, read and update your firm's Affinity CRM (companies, people, deals, notes and relationships) from OpenCode,
through Affinity's official MCP server.

Unofficial; not affiliated with Affinity.

Affinity is a trademark of Project Affinity, Inc.; this unofficial plugin is not endorsed by them.

This is Affinity CRM ([affinity.co](https://www.affinity.co)), the relationship-intelligence CRM for deal teams: not
Affinity Photo, Designer or Publisher, Canva's design apps.

## Requirements

- OpenCode `>=2.2.3 <2.4.0`, tested on 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0. Outside that range the plugin does not start, unless
  you set `allowUntestedHost`.
- macOS or Linux.
- An Affinity CRM account on the **Scale, Advanced or Enterprise** plan, which include API and MCP access.
- **Once per Affinity organisation**, someone with Affinity's `Manage all OAuth apps` permission (by default only
  Administrators) adds OpenCode as an app: Settings → Manage Apps → New App → **Client URL (CIMD)** (**Add by Client
  URL (CIMD)** for someone who can't create API keys), with `https://opencode.ai/oauth/opencode/client.json`, or
  registers the organisation's own **Public** OAuth app and sets its client ID in the plugin's `clientId` option (see
  [Organisation rollout](#organisation-rollout)). If the Client URL (CIMD) button is missing, ask your Affinity contact
  to turn it on, or use the organisation's own app. Until then Affinity's sign-in shows
  `Auth Error (SERVER-OAUTH-003) Unknown client_id` instead of asking for access.
- What you can see follows your Affinity permissions. Note and file search need **Deal Assist**, and the meeting tools
  need **unified events**; ask your Affinity admin.
- Every call counts against your organisation's monthly Affinity API quota, which the whole firm shares (100,000 calls a
  month on Scale and Advanced).
- Affinity hosts its data in the United States.

## Install

```sh
opencode plugin add github:joe-broadhead/opencode-affinity#v0.0.5
```

Run `opencode reload`, or restart OpenCode. Then run `/affinity-status`: it shows `sign-in required` until you sign in
(see [Sign in](#sign-in)).

Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-affinity#v0.0.4`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-affinity#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-affinity#v0.0.5" }] }
```

The plugin registers Affinity's MCP server under the name `affinity`, adds default permission rules, the
`/affinity-status` command, the `/affinity` status view and two skills. Every tool is Affinity's, and OpenCode handles
the connection, the sign-in and the stored credentials.

The install takes the GitHub release tag. Its commit carries the built `dist/`, so the install runs no build.
A new release is a new tag: install it with its own `#v<version>` spec.

## Sign in

Run `/connect` and choose **Affinity** (it is listed under MCP). In the terminal UI, press `o` or Enter to open the link
to Affinity's sign-in page in your browser, choose your organisation and sign in. No key is needed.

From a terminal, run `opencode mcp auth affinity` instead; it opens the link automatically. `/mcps` also offers the
same sign-in. Run it from the project folder where the plugin is installed, or remove the account in `/connect` → **Affinity**. If it answers `MCP server not found: affinity`, OpenCode is still opening that folder: wait a few seconds and run it again.

Affinity's consent screen lists three scopes, all ticked. **Untick `mcp` (changes) for a read-only connection**, and
keep `offline_access`: reads work, Affinity refuses every change, and without `offline_access` the sign-in expires after
a day. Sign in again with `mcp` ticked to allow changes.

If Affinity shows `Unknown client_id` (SERVER-OAUTH-003) or another error page instead of the consent screen, your
organisation has not added OpenCode yet, or, with the `clientId` option, its own app is not set up as that section
says: ask an Affinity admin to follow [Organisation rollout](#organisation-rollout), then sign in again. OpenCode's sign-in waits for
an answer that Affinity does not send, so close it and start again once the admin has added OpenCode.

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
- "Move Acme Robotics to Due Diligence."
- "Run a backchannel on the CTO candidate at our portfolio company Acme Robotics."
- "Build a market map of climate-tech startups and flag the ones we know."

Contact details, relationship scores and inferred connections are other people's personal data: the model reads them
only for your question, labels Affinity's scores and AI Notetaker summaries as Affinity's, and keeps CRM data out of
other tools unless you name the destination. It keeps calls few, because they count against the firm's quota.

| Command | What it does |
| --- | --- |
| `/affinity-status` | Posts the status report into the session: connection, account, access, organisation setup, tools, agents without the default rules, the OpenCode check and the next step. The model can read it too. |
| `/affinity`, or "Affinity: Status" in the command palette | Opens the same report in a dialog. Press `r` to refresh it and `Esc` to close it. It also refreshes when Affinity's connection, the sign-in or the agents change. |

The organisation and the grant in the report appear after the model's first account read (`affinity_get_current_user`)
since OpenCode started, or a consumer's `probe`; the plugin makes no Affinity call of its own, only those a model, a
script or a source's consumer asks for.

Two skills teach the model to use Affinity well:

- `affinity`: finding companies, people and deals, lists and pipelines, relationship strengths and inferred paths,
  notes, meetings and transcripts, Affinity's own workflow playbooks (whose text never overrides the skill's rules),
  the quota, and the rules for other people's data.
- `affinity-write`: whom each change reaches (the whole firm's CRM, a colleague, everyone in the organisation), reading
  first, the updates that replace a whole set, and saying what a change does before the call: at the default
  `access` it runs without a prompt, and `ask-changes` makes OpenCode's prompt the yes.

### Scripts

A script or a cron job can call every known Affinity tool with no model, through `opencode api`. It runs as a session
and its agent, under that agent's permission rules and the session's own. Only a rule that resolves to `allow` runs,
and under the default every method resolves to `allow`: a script can change the firm's CRM. A session that restricts
with `ask-changes` or `read-only` needs an explicit `allow` for the method in the session's or the agent's rules. An
`ask` is refused before anything reaches Affinity, and a saved "Always allow" does not authorise a script. Every call
counts against the firm's quota:

```sh
opencode api post /api/rpc/affinity.crm.tools/get_lists \
  -H "x-opencode-directory:$PWD" \
  -d '{"input":{"sessionID":"ses_…","input":{"term":"Pipeline"}}}'
```

OpenCode also lists Affinity's twelve workflow playbooks as `/affinity:<name>` commands, such as
`/affinity:affinity-meeting-prep` and `/affinity:warm-intro`. A run is your request for that routine; the text it adds
is Affinity's, so its steps are guidance, and any change still needs your own sentence; at `ask-changes` it also needs
OpenCode's permission prompt.

A script's reads run under the rules of the location it calls, not of a session's own location (a limit of the shared
tools module); see [Scripting](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/scripting.md).

### The meetings source

The plugin declares one source of the [source contract](https://github.com/we-the-rebel-alliance/source-contract) in
`package.json`'s `sources`, so Memory, jelly, Artifacts and any other consumer can read your Affinity meetings with
your consent: `affinity.meetings`, events of kind `meeting`. A consumer calls two tools RPC methods, never tools the
model sees, and the default rules allow both under every `access` value, because they only read:

- `probe` (`affinity_probe`) makes one `get_current_user` call and names who is signed in: the account
  `<organisation id>/<email>`, its owner (`mailto:` and the email, labelled with your name and the organisation's) and
  the sign-in's scopes. It remembers the answer for the current sign-in, in memory only.
- `events_list` (`affinity_events_list`) lists, oldest first, the meetings you organised, created or attended, one
  event per meeting: Affinity's meeting id, its start, its title, and the people on it whom Affinity matched to a
  person record (`affinity:person/<id>` and their name). It carries no notes, transcripts, email addresses, phone
  numbers, relationship scores or link (Affinity's meetings have none); its text is always empty. A meeting is listed
  once it started an hour ago. A listing names the account `probe` named, and is refused until `probe` has named it
  for the current sign-in; a new sign-in forgets it. A meeting whose title holds a secret is refused for good.
- A meeting logged in Affinity after a listing passed its start (logged late, or a calendar connected later) is
  listed by a later listing, once, wherever in the read-back it started. A 10-minute margin absorbs Affinity's indexing
  lag and clock skew.
- It reads back 90 days, by choice, to bound the quota. A `since` further back starts at 90 days with `gap`
  `window-truncated`, and a cursor more than 100 days old restarts there with `gap` `expired`, each once.

Every call counts against the firm's monthly API quota, so a listing makes **at most 10 calls**, whatever it finds,
and usually one: a consumer that reads every hour makes one call a listing, and so does a first read of the last day.
A page that runs out of calls ends with what it listed, `more: true`, and a cursor that carries on, so a calendar
backfill of thousands of meetings drains over several listings at no more than 10 calls each. Affinity lists every
meeting you may see, colleagues' included, and the source keeps only yours, so a firm whose calendars Affinity shares
widely uses more calls. Each page's `cost` says how many calls it made; a probe is one call. `npm run conformance` runs
the contract's conformance kit over the source, and each release attaches its report.

## Permissions

**Every tool is allowed by default.** The plugin adds one block to every agent, right after the agent's base rule that
allows everything, and that block allows Affinity's tools: reads, the workflow playbooks, creates, updates, upserts,
the deletes, the merges and `send_feedback` alike. An agent can therefore create a note, rewrite a deal's field values,
merge two companies, or delete a reminder without a prompt. `/affinity` and `/affinity-status` show the block, the
access value and the tools involved.

There are three ways to restrict it.

### 1. The `access` option

```json
{
  "plugins": [
    { "package": "github:joe-broadhead/opencode-affinity#v0.0.5", "options": { "access": "ask-changes" } }
  ]
}
```

| `access` | What runs |
| --- | --- |
| `all` (the default) | every Affinity tool runs without a prompt |
| `ask-changes` | a read and a playbook run; every other tool asks, including one Affinity adds later |
| `read-only` | a read and a playbook run; every other tool is denied, and hidden from the model |

The block is generated from the tool table and the value, so `/affinity` always shows what is in force. The three
blocks:

#### `all` (the default)

The plugin adds these rules for `access: "all"`:

```json
[
    { "action": "affinity_*", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_current_user", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_companies_top_matches", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_all_companies", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_company_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_company_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_merge_task", "resource": "*", "effect": "allow" },
    { "action": "affinity_render_market_map", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_fields", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_list_fields", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_list_field_dropdown_options", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_field_dropdown_options", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_field_value_changes", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_investor_executive_connections", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_coworker_connections", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_lists", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_single_list_entry", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_list_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_meetings", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_meetings_for_entity", "resource": "*", "effect": "allow" },
    { "action": "affinity_query_notes", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_notes_for_entity", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entities_attached_to_note", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_notes", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_files", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_file_metadata", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_files", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_opportunities", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_persons", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_person_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_persons_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_person_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_person_relationships", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_company_relationships", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_reminders", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_saved_views", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_saved_view_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_transcript_fragments", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_users", "resource": "*", "effect": "allow" },
    { "action": "affinity_render_warm_intro_graph", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_data_migration", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_event_setup", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_lp_pipeline_brief", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_meeting_prep", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_missed_deal_review", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_reference_check", "resource": "*", "effect": "allow" },
    { "action": "affinity_company_signals", "resource": "*", "effect": "allow" },
    { "action": "affinity_crm_audit", "resource": "*", "effect": "allow" },
    { "action": "affinity_customer_ready_to_raise", "resource": "*", "effect": "allow" },
    { "action": "affinity_market_map_generator", "resource": "*", "effect": "allow" },
    { "action": "affinity_portfolio_attention_score", "resource": "*", "effect": "allow" },
    { "action": "affinity_warm_intro", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_company", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_field", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_list_field_dropdown_option", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_interaction", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_list", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_list_entry", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_note", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_opportunity", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_person", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_reminder", "resource": "*", "effect": "allow" },
    { "action": "affinity_issue_entity_files_upload_token", "resource": "*", "effect": "allow" },
    { "action": "affinity_issue_entity_files_download_token", "resource": "*", "effect": "allow" },
    { "action": "affinity_update_company", "resource": "*", "effect": "allow" },
    { "action": "affinity_update_list_field_dropdown_option", "resource": "*", "effect": "allow" },
    { "action": "affinity_upsert_entity_field_values", "resource": "*", "effect": "allow" },
    { "action": "affinity_upsert_list_entry_field_values", "resource": "*", "effect": "allow" },
    { "action": "affinity_update_note", "resource": "*", "effect": "allow" },
    { "action": "affinity_update_opportunity", "resource": "*", "effect": "allow" },
    { "action": "affinity_update_person", "resource": "*", "effect": "allow" },
    { "action": "affinity_update_reminder", "resource": "*", "effect": "allow" },
    { "action": "affinity_delete_company", "resource": "*", "effect": "allow" },
    { "action": "affinity_delete_person", "resource": "*", "effect": "allow" },
    { "action": "affinity_delete_opportunity", "resource": "*", "effect": "allow" },
    { "action": "affinity_delete_note", "resource": "*", "effect": "allow" },
    { "action": "affinity_delete_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_delete_list_field_dropdown_option", "resource": "*", "effect": "allow" },
    { "action": "affinity_delete_reminder", "resource": "*", "effect": "allow" },
    { "action": "affinity_merge_companies", "resource": "*", "effect": "allow" },
    { "action": "affinity_merge_persons", "resource": "*", "effect": "allow" },
    { "action": "affinity_send_feedback", "resource": "*", "effect": "allow" },
    { "action": "affinity_events_list", "resource": "*", "effect": "allow" },
    { "action": "affinity_probe", "resource": "*", "effect": "allow" }
]
```

#### `ask-changes`

The plugin adds these rules for `access: "ask-changes"`:

```json
[
    { "action": "affinity_*", "resource": "*", "effect": "ask" },
    { "action": "affinity_get_current_user", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_companies_top_matches", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_all_companies", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_company_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_company_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_merge_task", "resource": "*", "effect": "allow" },
    { "action": "affinity_render_market_map", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_fields", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_list_fields", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_list_field_dropdown_options", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_field_dropdown_options", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_field_value_changes", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_investor_executive_connections", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_coworker_connections", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_lists", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_single_list_entry", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_list_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_meetings", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_meetings_for_entity", "resource": "*", "effect": "allow" },
    { "action": "affinity_query_notes", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_notes_for_entity", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entities_attached_to_note", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_notes", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_files", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_file_metadata", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_files", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_opportunities", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_persons", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_person_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_persons_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_person_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_person_relationships", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_company_relationships", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_reminders", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_saved_views", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_saved_view_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_transcript_fragments", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_users", "resource": "*", "effect": "allow" },
    { "action": "affinity_render_warm_intro_graph", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_data_migration", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_event_setup", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_lp_pipeline_brief", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_meeting_prep", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_missed_deal_review", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_reference_check", "resource": "*", "effect": "allow" },
    { "action": "affinity_company_signals", "resource": "*", "effect": "allow" },
    { "action": "affinity_crm_audit", "resource": "*", "effect": "allow" },
    { "action": "affinity_customer_ready_to_raise", "resource": "*", "effect": "allow" },
    { "action": "affinity_market_map_generator", "resource": "*", "effect": "allow" },
    { "action": "affinity_portfolio_attention_score", "resource": "*", "effect": "allow" },
    { "action": "affinity_warm_intro", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_company", "resource": "*", "effect": "ask" },
    { "action": "affinity_create_field", "resource": "*", "effect": "ask" },
    { "action": "affinity_create_list_field_dropdown_option", "resource": "*", "effect": "ask" },
    { "action": "affinity_create_interaction", "resource": "*", "effect": "ask" },
    { "action": "affinity_create_list", "resource": "*", "effect": "ask" },
    { "action": "affinity_create_list_entry", "resource": "*", "effect": "ask" },
    { "action": "affinity_create_note", "resource": "*", "effect": "ask" },
    { "action": "affinity_create_opportunity", "resource": "*", "effect": "ask" },
    { "action": "affinity_create_person", "resource": "*", "effect": "ask" },
    { "action": "affinity_create_reminder", "resource": "*", "effect": "ask" },
    { "action": "affinity_issue_entity_files_upload_token", "resource": "*", "effect": "ask" },
    { "action": "affinity_issue_entity_files_download_token", "resource": "*", "effect": "ask" },
    { "action": "affinity_update_company", "resource": "*", "effect": "ask" },
    { "action": "affinity_update_list_field_dropdown_option", "resource": "*", "effect": "ask" },
    { "action": "affinity_upsert_entity_field_values", "resource": "*", "effect": "ask" },
    { "action": "affinity_upsert_list_entry_field_values", "resource": "*", "effect": "ask" },
    { "action": "affinity_update_note", "resource": "*", "effect": "ask" },
    { "action": "affinity_update_opportunity", "resource": "*", "effect": "ask" },
    { "action": "affinity_update_person", "resource": "*", "effect": "ask" },
    { "action": "affinity_update_reminder", "resource": "*", "effect": "ask" },
    { "action": "affinity_delete_company", "resource": "*", "effect": "ask" },
    { "action": "affinity_delete_person", "resource": "*", "effect": "ask" },
    { "action": "affinity_delete_opportunity", "resource": "*", "effect": "ask" },
    { "action": "affinity_delete_note", "resource": "*", "effect": "ask" },
    { "action": "affinity_delete_list_entries", "resource": "*", "effect": "ask" },
    { "action": "affinity_delete_list_field_dropdown_option", "resource": "*", "effect": "ask" },
    { "action": "affinity_delete_reminder", "resource": "*", "effect": "ask" },
    { "action": "affinity_merge_companies", "resource": "*", "effect": "ask" },
    { "action": "affinity_merge_persons", "resource": "*", "effect": "ask" },
    { "action": "affinity_send_feedback", "resource": "*", "effect": "ask" },
    { "action": "affinity_events_list", "resource": "*", "effect": "allow" },
    { "action": "affinity_probe", "resource": "*", "effect": "allow" }
]
```

#### `read-only`

The plugin adds these rules for `access: "read-only"`:

```json
[
    { "action": "affinity_*", "resource": "*", "effect": "deny" },
    { "action": "affinity_get_current_user", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_companies_top_matches", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_all_companies", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_company_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_company_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_merge_task", "resource": "*", "effect": "allow" },
    { "action": "affinity_render_market_map", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_fields", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_list_fields", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_list_field_dropdown_options", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_field_dropdown_options", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_field_value_changes", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_investor_executive_connections", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_coworker_connections", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_lists", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_single_list_entry", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_list_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_meetings", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_meetings_for_entity", "resource": "*", "effect": "allow" },
    { "action": "affinity_query_notes", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_notes_for_entity", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entities_attached_to_note", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_notes", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_files", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_entity_file_metadata", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_files", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_opportunities", "resource": "*", "effect": "allow" },
    { "action": "affinity_search_persons", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_person_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_persons_info", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_person_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_person_relationships", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_company_relationships", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_reminders", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_saved_views", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_saved_view_list_entries", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_transcript_fragments", "resource": "*", "effect": "allow" },
    { "action": "affinity_get_users", "resource": "*", "effect": "allow" },
    { "action": "affinity_render_warm_intro_graph", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_data_migration", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_event_setup", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_lp_pipeline_brief", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_meeting_prep", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_missed_deal_review", "resource": "*", "effect": "allow" },
    { "action": "affinity_affinity_reference_check", "resource": "*", "effect": "allow" },
    { "action": "affinity_company_signals", "resource": "*", "effect": "allow" },
    { "action": "affinity_crm_audit", "resource": "*", "effect": "allow" },
    { "action": "affinity_customer_ready_to_raise", "resource": "*", "effect": "allow" },
    { "action": "affinity_market_map_generator", "resource": "*", "effect": "allow" },
    { "action": "affinity_portfolio_attention_score", "resource": "*", "effect": "allow" },
    { "action": "affinity_warm_intro", "resource": "*", "effect": "allow" },
    { "action": "affinity_create_company", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_field", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_list_field_dropdown_option", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_interaction", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_list", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_list_entry", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_note", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_opportunity", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_person", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_reminder", "resource": "*", "effect": "deny" },
    { "action": "affinity_issue_entity_files_upload_token", "resource": "*", "effect": "deny" },
    { "action": "affinity_issue_entity_files_download_token", "resource": "*", "effect": "deny" },
    { "action": "affinity_update_company", "resource": "*", "effect": "deny" },
    { "action": "affinity_update_list_field_dropdown_option", "resource": "*", "effect": "deny" },
    { "action": "affinity_upsert_entity_field_values", "resource": "*", "effect": "deny" },
    { "action": "affinity_upsert_list_entry_field_values", "resource": "*", "effect": "deny" },
    { "action": "affinity_update_note", "resource": "*", "effect": "deny" },
    { "action": "affinity_update_opportunity", "resource": "*", "effect": "deny" },
    { "action": "affinity_update_person", "resource": "*", "effect": "deny" },
    { "action": "affinity_update_reminder", "resource": "*", "effect": "deny" },
    { "action": "affinity_delete_company", "resource": "*", "effect": "deny" },
    { "action": "affinity_delete_person", "resource": "*", "effect": "deny" },
    { "action": "affinity_delete_opportunity", "resource": "*", "effect": "deny" },
    { "action": "affinity_delete_note", "resource": "*", "effect": "deny" },
    { "action": "affinity_delete_list_entries", "resource": "*", "effect": "deny" },
    { "action": "affinity_delete_list_field_dropdown_option", "resource": "*", "effect": "deny" },
    { "action": "affinity_delete_reminder", "resource": "*", "effect": "deny" },
    { "action": "affinity_merge_companies", "resource": "*", "effect": "deny" },
    { "action": "affinity_merge_persons", "resource": "*", "effect": "deny" },
    { "action": "affinity_send_feedback", "resource": "*", "effect": "deny" },
    { "action": "affinity_events_list", "resource": "*", "effect": "allow" },
    { "action": "affinity_probe", "resource": "*", "effect": "allow" }
]
```

### 2. An agent's own rules

A rule in an agent's own `permissions` comes after the plugin's block, so it wins for that agent. An agent that creates
and updates notes but asks before a merge:

```json
{
  "agents": {
    "build": {
      "permissions": [
        { "action": "affinity_*", "resource": "*", "effect": "ask" },
        { "action": "affinity_create_note", "resource": "*", "effect": "allow" },
        { "action": "affinity_update_note", "resource": "*", "effect": "allow" }
      ]
    }
  }
}
```

### 3. A per-tool rule

Every action is `affinity_` followed by the tool's name. A later rule wins, so this denies one tool in the top-level
`permissions`, for every agent:

```json
{
  "permissions": [
    { "action": "affinity_delete_company", "resource": "*", "effect": "deny" }
  ]
}
```

The seven deletes remove CRM data for good, and two have no confirmation step in Affinity. The two merges delete the
duplicate, and a merge with a global company can't be undone. `affinity_send_feedback` sends text to Affinity's team,
and Affinity's own instructions tell the model to offer it whenever something can't be done.

### What each change reaches

Say what a change does and whom it reaches before you make it. Every change reaches the firm's shared CRM, which your
colleagues see. Everything that comes later than these rules still wins: an agent's own stricter rules (Explore cannot
use Affinity), your `permissions` in `opencode.json`, and your saved "Always allow" answers.

Agents that exist only in your own config, and agents added by plugins that load later, are created after the plugin
adds its rules, so they get no block. With `access: "all"` that changes nothing; with `ask-changes` or `read-only` they
stay unrestricted, and `/affinity-status` and `/affinity` name them with the block to put first in each one's own
`permissions`. Do not put an `ask` or an `allow` in the top-level `permissions`, which would loosen Explore.
[Configuration](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/configuration.md#permissions) has a
worked example and permission recipes.

## Configure

Set options with the object form of the plugin entry:

```json
{
  "plugins": [{ "package": "github:joe-broadhead/opencode-affinity#v0.0.5", "options": { "allowUntestedHost": true } }]
}
```

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `allowUntestedHost` | `true` or `false` | `false` | Starts on an OpenCode version outside `>=2.2.3 <2.4.0`, with a warning in status. |
| `clientId` | the client ID (a UUID) of your organisation's own Public OAuth app in Affinity | none | Signs in as that app instead of with OpenCode's client URL. The plugin keeps Affinity's URL and the scope `mcp mcp.read offline_access`. Your own `mcp.servers.affinity` still wins. |

[docs/configuration.md](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/configuration.md) has the
details, including your own `mcp.servers.affinity` entry (a read-only sign-in for everyone, your organisation's own
OAuth app, or an Affinity API key), permission recipes and every error.

## Organisation rollout

An admin of your Affinity organisation, with Affinity's `Manage all OAuth apps` permission (by default only
Administrators), takes one of two routes, once. Both
sign in through `/connect` and keep a refresh token; members never handle a secret.

### Route 1: OpenCode's client URL

OpenCode signs in to Affinity with its own client metadata document, so there is no client ID to distribute. Affinity
accepts it only after the admin adds it:

1. In Affinity, open Settings → Manage Apps → **New App** → **Client URL (CIMD)**. Someone who can't create API keys
   sees **Add by Client URL (CIMD)** instead.
2. Paste `https://opencode.ai/oauth/opencode/client.json`, and choose **Preview**. The preview warns that every
   redirect URI is on localhost: that is expected, because OpenCode is a desktop client that receives the sign-in on
   your own machine.
3. Allow the scopes `mcp`, `mcp.read` and `offline_access`, and choose **Add App**. Allowing only `mcp.read` makes every
   member's connection read-only; members then need the read-only entry in
   [Configuration](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/configuration.md#read-only-for-everyone),
   or Affinity refuses their sign-in with `invalid_scope`.

Revoking that app in Manage Apps disconnects every member's OpenCode at once. Affinity's Settings → Affinity MCP page
lists only Affinity's built-in clients, not OpenCode.

### Route 2: your organisation's own OAuth app

Where the Client URL route is not available, or the organisation prefers an app it owns:

1. In Affinity, open Settings → Manage Apps → **New App** → **OAuth App**.
2. Choose the **Public** client type: OpenCode signs in with PKCE and keeps no client secret.
3. Add the redirect URIs `http://127.0.0.1/callback`, `http://localhost/callback` and
   `http://127.0.0.1/mcp/oauth/callback`. Affinity matches a loopback redirect URI on any port, and OpenCode sends the
   port it listens on.
4. Allow the scopes `mcp`, `mcp.read` and `offline_access`, and save. Copy the app's client ID, a UUID; it is not a
   secret.
5. Set it as the plugin's `clientId` option, as below.

The plugin then registers the server at `https://mcp.affinity.co/mcp` with that client ID and the scope
`mcp mcp.read offline_access`, so nobody writes a server entry by hand. `/affinity-status` shows "Sign-in client: your
organisation's OAuth app" and the ID's first 8 characters. Revoking the app disconnects every member at once.

### Then, for everyone

Put the plugin entry in the system config: `/Library/Application Support/opencode/opencode.json` on macOS, or
`/etc/opencode/opencode.json` on Linux. This example also turns off two changes for everyone: new fields and new list
dropdown options, which change every record of their type:

```json
{
  "plugins": [{ "package": "github:joe-broadhead/opencode-affinity#v0.0.5" }],
  "permissions": [
    { "action": "affinity_create_field", "resource": "*", "effect": "deny" },
    { "action": "affinity_create_list_field_dropdown_option", "resource": "*", "effect": "deny" }
  ]
}
```

With route 2, add the app's client ID to the same entry:

```json
{
  "plugins": [
    { "package": "github:joe-broadhead/opencode-affinity#v0.0.5", "options": { "clientId": "<your app's client ID>" } }
  ]
}
```

Members then only sign in: run `/connect` and choose Affinity, then press `o` or Enter to open the link. A member's own
`mcp.servers.affinity` entry still wins over the option; their status then says the option is ignored. Affinity API keys
are personal, so an organisation cannot set one for its members. Affinity's terms bar using Affinity data to train AI
models; check your firm's AI policy before you turn this on.

## Troubleshooting

Run `/affinity-status` first. Its last line is the next step.

| Status or error | What to do |
| --- | --- |
| Connection: sign-in required | Run `/connect` and choose Affinity, then press `o` or Enter to open the link. In a terminal, `opencode mcp auth affinity` opens it automatically (from the project folder; see [Sign in](#sign-in)). |
| Organisation setup row: Affinity shows an error page instead of asking for access | This is a first sign-in, and your organisation has not added OpenCode yet. Ask someone with Affinity's `Manage all OAuth apps` permission (by default an Administrator) to add `https://opencode.ai/oauth/opencode/client.json` under Settings → Manage Apps → New App → Client URL (CIMD), as [Organisation rollout](#organisation-rollout) shows, then sign in again. With the `clientId` option, the admin checks your organisation's own app instead: a Public app with the redirect URIs and scopes that section lists. A sign-in that worked before and now needs one again is an expiry: run `/connect` again. |
| The sign-in fails with `invalid_scope` | The app Affinity sees (the Sign-in client row) does not allow every scope the sign-in asks for. Often your organisation allows only the read-only scope: use the read-only entry in Configuration, or ask the admin to allow `mcp` too. With the `clientId` option, ask the admin to allow `mcp`, `mcp.read` and `offline_access` on that app. |
| Affinity answers `Unknown client_id` (`SERVER-OAUTH-003`) | Affinity does not know the client the sign-in names. With the `clientId` option, the ID is mistyped, or names an app of another Affinity organisation, or the app was deleted: copy the client ID again from Settings → Manage Apps, or remove the option to use OpenCode's client URL. Without it, your organisation has not added OpenCode's client URL yet: see [Organisation rollout](#organisation-rollout). |
| Sign-in client: the `clientId` option is ignored because your entry wins | Your own `mcp.servers.affinity` decides how you sign in. Remove it to use the option, or put the client ID in its `oauth.client_id`. |
| Connection: connecting | Wait a few seconds, then run `/affinity-status` again. |
| Connection: failed | Check your network, then run `/affinity-status` again. With your own entry that sends an API key, check the key (Affinity: Settings, Manage Apps). |
| Connection: disabled | Enable `affinity` in `/mcps`, or remove `"disabled": true` from `mcp.servers.affinity` in `opencode.json`. |
| Connection: not configured | An organisation policy (`mcp.use`) or another plugin removes the `affinity` server. Ask your administrator, then restart OpenCode. |
| Connection: conflict | Your config has an `mcp.servers.affinity` entry with a URL other than `https://mcp.affinity.co/mcp`. Point it at `https://mcp.affinity.co/mcp` or remove it, then restart OpenCode. |
| Tools: none listed yet | Affinity connected moments ago and is still listing its tools. Run `/affinity-status` again, or press `r` in the dialog, in a few seconds. |
| Tools: a tool Affinity adds | Every tool is allowed by default, so it runs at once. See [Permissions](#permissions) to restrict it. |
| Tools: unknown | Affinity added tools the plugin does not know yet. They follow `access`: allowed at `"all"`, asked for at `"ask-changes"`, denied at `"read-only"`. |
| Access: default rules missing or not added | Some agents lack the default rules (see the agents row), or OpenCode could not add them (see the OpenCode row). Follow the next step. |
| Access: Affinity grant: read-only | You unticked `mcp` (changes) at sign-in, so Affinity refuses changes with `Insufficient scope`. To allow changes, sign out (`opencode mcp logout affinity`, from the project folder; see [Sign in](#sign-in)) and sign in again with `mcp` ticked. |
| Note or file search returns an error about Deal Assist | Your organisation doesn't have Deal Assist. Ask your Affinity admin; other reads still work. |
| Meetings return an access error about unified events | Your organisation hasn't finished Affinity's unified events onboarding. Ask your Affinity admin. |
| `429` or `Rate limit exceeded` | Your organisation's monthly API quota, or a short burst limit, is used up. Affinity shows usage in Settings; the quota is shared by the whole firm. |
| An answer misses records a colleague can see | Results follow your own Affinity permissions. Ask the colleague or an Affinity admin. |
| Agents without default rules | Put the default rules shown by `/affinity-status` first in each listed agent's own permissions, in `opencode.json` or the agent's Markdown file, followed by your top-level rules for Affinity tools. |
| OpenCode: untested | OpenCode is not 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 or 2.3.0. Inside `>=2.2.3 <2.4.0` the plugin runs normally; outside it, it runs only because `allowUntestedHost` is set. If Affinity misbehaves, use a tested release. |
| Signed in to the wrong Affinity organisation | Run `opencode mcp logout affinity` from the project folder (or remove the account in `/connect` → Affinity; see [Sign in](#sign-in)), then sign in again and choose the other organisation. |
| An Affinity tool is refused in `opencode run` | Nobody could answer its prompt. Add an `allow` rule for that **read** to the agent's own `permissions`, if you want it unattended. A change needs an interactive session: run it there, where the prompt can be answered. |
| A skill seems ignored, and status names a skill to rename or move | A skill of yours with the same id, such as `affinity`, replaces the plugin's. Rename or move it. |
| `/affinity` is missing | The plugin did not start. Run `/plugins` to see the error. |
| An error code such as `OPTIONS_INVALID` | See [Errors](#errors) for the code, where it comes from and what to do. |

## Errors

Every error reads `CODE: What happened. Next step: What to do.` The codes are the plugin's own one table. `setup` and
`status` codes come from the plugin; `rpc` and `source` codes are a refusal from the tools RPC for scripts, which
[Scripting](https://github.com/joe-broadhead/opencode-affinity/blob/HEAD/docs/scripting.md#errors) explains in detail.

| Code | Surface | When |
| --- | --- | --- |
| `HOST_UNTESTED` | setup | OpenCode is outside the supported range and `allowUntestedHost` is not set. |
| `OPTIONS_INVALID` | setup | An option is unknown or has a wrong value. |
| `SKILLS_INVALID` | setup | A skill file is missing or broken; the plugin still starts. |
| `SERVER_NOT_REGISTERED` | setup | The `affinity` server could not be registered. |
| `RULES_NOT_ADDED` | setup | The default permission rules could not be added. |
| `STATUS_UNAVAILABLE` | status | The status could not be read, or the plugin is not running. |
| `SESSION_UNKNOWN` | rpc | The session does not exist in this location. |
| `SESSION_AGENT_REQUIRED` | rpc | The session names no agent, or one that does not exist. |
| `PERMISSION_DENIED` | rpc | The last matching rule is an `ask` or a `deny`; refused before dispatch. |
| `SERVER_CONFLICT` | rpc | `mcp.servers.affinity` is defined at another URL. |
| `AUTH_REQUIRED` | rpc | The `affinity` server needs a sign-in. |
| `CONNECTING` | rpc | The `affinity` server is still connecting. |
| `CONNECTION_FAILED` | rpc | The `affinity` server could not connect. |
| `DISABLED` | rpc | The `affinity` server is disabled. |
| `NOT_REGISTERED` | rpc | The `affinity` server is not registered. |
| `TOOL_UNAVAILABLE` | rpc | The server is connected but OpenCode does not list the tool. |
| `UPSTREAM_ERROR` | rpc | Affinity answered with an error, such as an invalid input or a rate limit. |
| `CANCELLED` | rpc | The request was cancelled. |
| `INPUT_INVALID` | source | `events_list` or `probe` got an input it does not take, or no account. |
| `SOURCE_UNKNOWN` | source | The input names a source other than `affinity`. |
| `ACCOUNT_MISMATCH` | source | The account or cursor is another than the one Affinity is signed in to. |
| `CURSOR_INVALID` | source | The cursor was not issued by this source for this account. |
| `NEEDS_SIGN_IN` | source | The `affinity` server needs a sign-in. |
| `SCOPE_MISSING` | source | The Affinity sign-in lacks a scope the read needs. |
| `RATE_LIMITED` | source | Affinity refused a call for a rate limit or the firm's monthly API quota. |
| `UNAVAILABLE` | source | Probe has not named the sign-in yet, or Affinity's answer could not be read. |

`source` codes are the source contract's own, from the meetings source's `events_list` and `probe` (see
[The meetings source](#the-meetings-source)).

The status RPC's own error is `unavailable`, with a next step, when the status cannot be read.

## Known limits

- **The tool table comes from Affinity's own server package.** The names, parameters and playbook text come from
  `affinity-mcp`, read without running it, and Affinity ships changes often. A tool it adds is allowed at once, counted
  as unknown, and not a method of the tools RPC until a release lists it. The table has not been checked against a
  signed-in server's tool list yet: `npm run drift` compares a saved list with it, and `CONTRIBUTING.md` has the steps.
- Whether the model writes its sentence on whom a change reaches before a call depends on the model: the rules cannot
  make it. A script's reads follow the location it calls, not the session's location (a limit of the shared tools
  module).

- **The meetings source** keeps a meeting only when your email is its organiser's, its creator's or one of the
  attendees Affinity previews, at most 100; Affinity's docs don't say that your user id is your person id, so the
  source doesn't match on it. You are not matched to a larger meeting where you are past the preview, or to one you
  were invited to by an alias. A meeting deleted before a listing reaches it is never listed, and no gap says so (a
  deletion after it was listed will be announced once consumers read the contract's `removals[]`). More than 1,000
  visible meetings that start in the same second cannot be read whole, and `events_list` answers `UNAVAILABLE` for them.
- In Jelly, the `access` setting is drawn as a choice of three, which needs a Jelly that reads declared choices: an
  older Jelly refuses the plugin's whole declaration.
- Updates are not automatic for a Git install, and `opencode plugin update` and `opencode plugin check` do not work on one: to move to a newer release, remove the old entry and add the new tag.

## Uninstall

Sign out while the plugin is still installed: once it is removed, OpenCode no longer knows the `affinity` server, so
`opencode mcp logout affinity` fails with `MCP server not found: affinity` and the sign-in stays in OpenCode's
credential store.

1. Sign out: `opencode mcp logout affinity` from the project folder. Right after OpenCode starts or reloads, it can
   answer `MCP server not found: affinity` for a few seconds; wait, then run it again.
2. Check: `/connect` → **Affinity** shows no account; `opencode auth list` after step 3 shows no Affinity credential.
3. Remove the plugin: `opencode plugin remove github:joe-broadhead/opencode-affinity#v0.0.5`, then `opencode reload`.
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
