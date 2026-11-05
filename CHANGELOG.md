# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.0] - Unreleased

### Added

- Registers Affinity's official MCP server, `https://mcp.affinity.co/mcp`, as `affinity`, signed in with OpenCode's own
  MCP OAuth and the scope `mcp mcp.read offline_access`, pinned so the refresh token stays. No client ID or key to
  configure; an Affinity admin adds OpenCode's client URL once per organisation.
- Names the server's `/connect` entry "Affinity", and marks its account "Sign in required" while the server needs a new
  sign-in.
- Adopts your own `mcp.servers.affinity` at Affinity's URL unchanged, including a read-only sign-in, your
  organisation's own OAuth app, or an Affinity API key in its headers. The plugin never reads those headers. Any other
  URL, or a local command, is a conflict that status explains.
- Default permission rules after each agent's base allow: every Affinity tool asks, and Affinity's read tools,
  including its workflow playbooks, run without a prompt. Ten tools are denied: the seven deletes, the two merges and
  `affinity_send_feedback` (text sent to Affinity's team). The docs give a clean-up agent that turns them back on, each
  as an ask.
- `/affinity-status` and the `/affinity` dialog ("Affinity: Status" in the palette): connection, account, access,
  organisation setup, tools, agents without the default rules, the OpenCode check and one next step. The organisation
  and grant come from the first `get_current_user` call, kept in memory only. While a sign-in is required, status gives
  the admin step for an organisation that has not added OpenCode (`CLIENT_NOT_ALLOWED`). A skill of yours with one of
  the plugin's ids is named, with a next step.
- The status RPC `affinity.crm/status`, with the fields this family of plugins shares.
- The tools RPC `affinity.crm.tools`, which lets scripts call Affinity's read tools with no model, as a session and
  its agent.
- Two skills: `affinity` (finding records, pipelines, relationships, notes, meetings and transcripts, Affinity's
  playbooks under the skill's own rules, the shared API quota, and the rules for other people's data) and
  `affinity-write` (whom each change reaches, said before the call, with OpenCode's permission prompt as the yes).
- The option `allowUntestedHost`, and a host check for OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4 and 2.2.5.
- A `jelly` declaration for Jelly: the tools with their default effects, the skills, the sign-in, a summary and an
  icon.
