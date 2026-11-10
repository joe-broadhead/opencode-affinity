# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.0] - 2026-11-10

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
