# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **Affinity** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference. The mark is two overlapping rings on a slate tile, not Affinity's logo or colours. Jelly's
declaration contracts drop a top-level key they don't know, and refuse an unknown key inside a tool, sign-in or
`contributes` entry, so the section uses only the keys Jelly reads.

## Icons and the vendor

`opencode.icons` lists the same mark in three files of this package, in order: `assets/icon.svg`, then
`assets/icon-128.png` and `assets/icon-256.png`, each a raster rendered from that SVG and each with its
MCP `mimeType` and exact `sizes`. `jelly.icon` stays `assets/icon.svg`, the same file as the first entry.
The three files are also exported as `./icon.svg`, `./icon-128.png` and `./icon-256.png`, so a consumer
can resolve them from the installed package, and all three are in the published tarball.

`opencode.vendor` names the service behind the plugin: `{ "id": "affinity", "name": "Affinity", "domain":
"affinity.co" }`. A display app may show the vendor's official logo from the vendor's own site, under
the vendor's terms, using that domain. The package carries no vendor marks: every shipped file is this
family's own drawing, not Affinity's logo, shape or brand colour.

## Tools and permissions

Every tool in `src/affinity-tools.ts` is declared: each read tool, Affinity's workflow playbooks included, as
read-only with `allow`, each write tool with `ask`, and each denied tool with `deny`. Jelly's agents have no base
"allow everything" rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly
writes each declared effect as that tool's default (the person's own choice replaces it). Every tool is declared
`allow`, the family's default, so a Jelly agent can create a note, upsert a deal's field values, merge two companies or
delete a reminder without a prompt. A Jelly admin restricts one tool by setting its effect to `ask` or `deny` in the
card.

- The seven deletes remove CRM data for good: `affinity_delete_company`, `affinity_delete_person`,
  `affinity_delete_opportunity`, `affinity_delete_note`, `affinity_delete_list_entries`,
  `affinity_delete_list_field_dropdown_option` and `affinity_delete_reminder`.
- The two merges delete the duplicate: `affinity_merge_companies` and `affinity_merge_persons`.
- `affinity_send_feedback` sends text to Affinity's team.
- `affinity_issue_entity_files_download_token` returns a single-use download credential.

A tool the upstream server adds later is not declared, so in Jelly it runs with the plugin's own default: allowed, even
if it changes something, such as a new write to the CRM, until a new version of this plugin declares it. Affinity ships changes to
its server often, so this can happen between releases of the plugin. A Jelly admin can set such a tool to ask. Keep
`jelly.tools` in step with `src/affinity-tools.ts`; `test/unit/jelly.test.ts` checks the list against it, and each
declared effect against the plugin's own default rules.

## Skills

Declared: `affinity`, `affinity-write`. Jelly refuses an install whose skill ids collide with another plugin's or the
agent's own. Affinity serves workflow playbooks of its own, also as skills for other assistants (such as
`affinity-meeting-prep` and `warm-intro`); this plugin's ids differ from them.

## Views

None: `jelly.views` and `jelly.rpc` are empty, and the plugin contributes no Home feed or widget.
A feed of deals or contacts would put firm data on a dashboard and call Affinity unasked, against the firm's shared
API quota.

## Signing in

`jelly.signIns` declares one sign-in, `affinity`, for Affinity's MCP server `affinity`, which signs in with OpenCode's
MCP OAuth. Affinity accepts it once an Affinity admin has added OpenCode's client URL to the organisation; until then
Affinity shows an error page. A person who defines their own `mcp.servers.affinity` with `"oauth": false` and an API
key has no sign-in for Jelly to show; that server signs in with its own headers.

Jelly folds the declared sign-in into this plugin's one card, which shows it as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of it. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version, so publish each release under a new version: a review in Jelly
can then tell the two apart.
