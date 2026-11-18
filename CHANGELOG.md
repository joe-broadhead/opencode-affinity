# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-11-18

### Changed

- OpenCode 2.3.1 and 2.3.2 are tested too: tested on 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7, 2.3.0, 2.3.1 and 2.3.2, so the host and pack stages and CI run on each. The supported range is unchanged (`>=2.2.3 <2.4.0`), and so are the host devDependencies the checks compile against (2.2.3).

## [0.0.5] - 2026-11-17

Tested on OpenCode 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0.

### Added

- The `clientId` option, for an organisation that signs in through its own **Public** OAuth app in Affinity instead of
  adding OpenCode's client URL. The plugin registers the server at `https://mcp.affinity.co/mcp` with
  `oauth: { client_id, scope: "mcp mcp.read offline_access" }`, so nobody writes a server entry by hand, and the URL
  and the scope, with its refresh token, stay the plugin's. It must be a UUID: anything else is `OPTIONS_INVALID`,
  which shows only its first 8 characters; an empty value counts as unset. A user's own `mcp.servers.affinity` still
  wins, unchanged.
- Status, `/affinity-status` and the status RPC name the sign-in client in a new `Sign-in client` row and the
  `signInClient` field: the organisation's own app by the ID's first 8 characters, OpenCode's client URL, or the user's
  own entry, with "the clientId option is ignored because your entry wins" when both are set. With the option, the
  first-sign-in advice is about the organisation's own app (Public, its redirect URIs and scopes) instead of the client
  URL.
- **For jelly:** a **Client ID** setting, free text, wired to the option; `jelly.admin` names both routes.
- The README's Organisation rollout gives both routes, and Troubleshooting covers `Unknown client_id`
  (`SERVER-OAUTH-003`) and `invalid_scope` for either.
- **A source for Memory, jelly and Artifacts:** `package.json` declares `sources` (source contract version 1, the
  RPC `affinity.crm.tools`) with one events source, `affinity.meetings`, which reads `meeting`. Two new tools RPC
  methods serve it, never tools the model sees, and the default rules allow both under every `access` value:
  - `probe` (`affinity_probe`) makes one `get_current_user` call and names the account, `<organisation id>/<email>`,
    its owner (`mailto:` and the email, labelled with the person's and the organisation's names) and the sign-in's
    scopes. It records them for the current sign-in, in memory; a new or switched sign-in forgets them.
  - `events_list` (`affinity_events_list`) lists, oldest first, the meetings the signed-in person organised, created
    or attended, once each started an hour ago: the meeting's id, start, title and the people Affinity matched to a
    person record (`affinity:person/<id>` and their name). `text` is always empty and `url` null: no notes,
    transcripts, email addresses, phone numbers or relationship scores, and Affinity's meetings have no link. A listing
    names the account `probe` named and is refused until `probe` has named it, so it never spends a call asking who is
    signed in. A meeting logged in Affinity after a listing passed its start is listed once by a later listing,
    wherever in the read-back it started, with a 10-minute margin for Affinity's index lag and clock skew. A listing
    makes at most 10 `get_meetings` calls, usually one; one that runs out ends with what it listed and a cursor that
    carries on, so a calendar backfill drains over several listings. Each page's `cost` counts its calls. It reads
    back 90 days, by choice, to bound the quota: an older `since` answers `gap` `window-truncated`, a cursor more than
    100 days old `gap` `expired`, each once; a meeting deleted before a listing reaches it is never listed. The cursor
    is bound to the plugin, the source and the account. A meeting whose title holds a secret is refused for good. It
    assumes Affinity shows a new meeting within about 10 minutes (a slower one can be skipped) and that `createdAt` is
    when Affinity added the meeting, not when the calendar event was created (if not, meetings from a calendar
    connected later than they happened are not listed); both are checked at the first live sign-in.
  - The source contract's error codes: `INPUT_INVALID`, `SOURCE_UNKNOWN`, `ACCOUNT_MISMATCH`, `CURSOR_INVALID`,
    `NEEDS_SIGN_IN`, `SCOPE_MISSING`, `RATE_LIMITED` and `UNAVAILABLE`.
- `npm run conformance`, also a stage of `npm run check`: the source contract's conformance kit over the source,
  offline, writing `reports/conformance-report.json` for the release kit to attach.

### Changed

- The tools RPC's transport is the source contract's `tools-rpc` module (`@we-the-rebel-alliance/source-contract`
  v0.2.0, a devDependency bundled into `dist/index.js`), in place of the copy in `src/host/tools-rpc.ts`; Affinity's
  part is `src/tools-rpc.ts`. Methods, ids, classes and codes are unchanged.
- The admin step uses Affinity's own button names, **Client URL (CIMD)**, or **Add by Client URL (CIMD)** for someone
  who can't create API keys, says it needs Affinity's `Manage all OAuth apps` permission (by default only
  Administrators), and that the preview's warning about localhost redirect URIs is expected for OpenCode. The README,
  the status's advice and `jelly.admin` use the same name.

## [0.0.4] - 2026-11-15

### Added

- **For jelly:** `jelly.admin`, the step jelly shows on the plugin's review after "Before anyone signs in, your admin
  needs to": "add OpenCode as an app in Affinity (Settings > Manage Apps > New App > Client URL
  https://opencode.ai/oauth/opencode/client.json) with the scopes mcp, mcp.read and offline_access".

## [0.0.3] - 2026-11-15

### Changed

- OpenCode 2.3 is admitted: the host range is `>=2.2.3 <2.4.0` (it was `>=2.2.3 <2.3.0`), tested on 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0.
  The host and pack stages, CI and the release's install check run every one of them. A later 2.2 or 2.3 release
  starts and status calls it untested; the `HOST_UNTESTED` example host is now 2.4.0.
- Apart from the status fix below, OpenCode 2.3 needs nothing else from this plugin. It does not call the `subagent` tool or read
  `session.tool.failed`; Affinity's tools are Affinity's MCP tools, which OpenCode runs and stops itself when the person presses Stop; and it has no use
  for the new `session.fork` hook.
- The host test of a call that names another location waits until the plugin has loaded there: from OpenCode 2.2.7 a
  location opened by a call answers `rpc.unavailable` until its plugins have registered.
- The icon is now Affinity's own mark, Affinity's knot symbol in white on Affinity's aubergine, as in Affinity's own app icon, in place of the family's drawn mark; `opencode.vendor.mark` is `true`, and the README says Affinity is a trademark of Project Affinity, Inc.

### Fixed

- Status, `/affinity-status` and the `/affinity` dialog read the server's source and the default rules' outcome after listing
  the servers and agents. OpenCode records them only when something reads that state, so right after start-up a status
  read could miss them.

## [0.0.2] - 2026-11-14

### Changed

- `package.json` is `"private": true`, so nothing can be published to npm; an install from the release tag is unaffected.

## [0.0.1] - 2026-11-13

### Added

- The `jelly` settings declare their choices: `access` is drawn as Allowed, Ask before changes or Read only, with
  Jelly's own line for each (needs a jelly that includes app#1301).

## [0.0.0] - 2026-11-10
<!-- kit-release: the GitHub release v0.0.0 -->

### Changed

- Both skills explain how to connect Affinity when its tools are absent, including the administrator's client URL setup.

- Default permission rules after each agent's base allow: every tool is allowed, reads and changes alike, so an agent
  can create a note, rewrite a deal's field values, merge two companies or delete a reminder without a prompt. The
  option `access` restricts them: `ask-changes` asks for every change, and `read-only` denies every change. The README
  prints the block each value generates, and three ways to restrict a single agent or tool.
- The tools RPC is v2: every known tool is scriptable under a prior explicit allow, each method carries its class,
  `describe` takes a session and reports each method's permission, and `shapeInput` runs beside `shapeResult` so a
  script's call reaches Affinity with the model path's arguments. A saved "Always allow" no longer authorises an
  ad-hoc script: a grant is a rule in config, or a Jobs run session.

### Added

- Jelly shows an `access` setting (`all`, `ask-changes` or `read-only`; `all` by default), the option the plugin already reads.
- Registers Affinity's official MCP server, `https://mcp.affinity.co/mcp`, as `affinity`, signed in with OpenCode's own
  MCP OAuth and the scope `mcp mcp.read offline_access`, pinned so the refresh token stays. No client ID or key to
  configure; an Affinity admin adds OpenCode's client URL once per organisation.
- Names the server's `/connect` entry "Affinity", and marks its account "Sign in required" while the server needs a new
  sign-in.
- Adopts your own `mcp.servers.affinity` at Affinity's URL unchanged, including a read-only sign-in, your
  organisation's own OAuth app, or an Affinity API key in its headers. The plugin never reads those headers. Any other
  URL, or a local command, is a conflict that status explains.
- `/affinity-status` and the `/affinity` dialog ("Affinity: Status" in the palette): connection, account, access,
  organisation setup, tools, agents without the default rules, the OpenCode check and one next step. The organisation
  and grant come from the first `get_current_user` call, kept in memory only. While a sign-in is required, status gives
  the advice for a first sign-in in an organisation that has not added OpenCode. A skill of yours with one of
  the plugin's ids is named, with a next step.
- The status RPC `affinity.crm/status`, with the fields this family of plugins shares.
- The tools RPC `affinity.crm.tools`, which lets scripts call Affinity's read tools with no model, as a session and
  its agent.
- Two skills: `affinity` (finding records with the person, filter and date forms Affinity accepts, including each
  local midnight converted to UTC; pipelines, relationships, notes, meetings and transcripts; Affinity's playbooks
  under the skill's own rules; the shared API quota; and the rules for other people's data) and `affinity-write`
  (whom each change reaches, said before the call, the full-replace and upsert shapes, and OpenCode's permission
  prompt as the yes).
- Affinity's twelve workflow playbooks are also `/affinity:<name>` commands, since OpenCode turns MCP prompts into
  commands; running one sends Affinity's text to the model as your own message, and the skills' rules still decide
  what it may do.
- The option `allowUntestedHost`, and a host check for OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4, 2.2.5 and
  2.2.6.
- A `jelly` declaration for Jelly: the tools with their default effects, the skills, the sign-in, a summary and an
  icon.
- The family icon kit's mark and its 128 and 256 pixel rasters, declared in `opencode.icons` and exported from the
  package, with `opencode.vendor` naming Affinity's domain: a display app may show Affinity's own logo from Affinity's
  site, and the package carries no vendor marks.
