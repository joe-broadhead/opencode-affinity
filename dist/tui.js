// src/tui.ts
import { Plugin } from "@opencode/plugin/tui";

// src/redact.ts
var SECRETS = [
  [/\b(bearer|basic|token)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b([\w-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|signature|credential)["']?\s*[:=]\s*)["']?[^\s"'&,;]+["']?/gi, "$1[redacted]"],
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, "[redacted]"],
  [/\b(?:tvly|sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abposr]|lin_api|lin_oauth)[-_][\w-]{8,}/gi, "[redacted]"],
  [/[\w+=-]{40,}/g, "[redacted]"]
];
var REASON_LIMIT = 160;
var CONTROLS = /[\u0000-\u001f\u007f-\u009f]+/g;
var BIDI = /[‎‏‪-‮⁦-⁩]/g;
var withoutUrlSecrets = (text) => text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/^(https?:\/\/)[^/?#@]*@/i, "$1").replace(/[?#].*$/s, ""));
var oneLine = (text) => text.replace(BIDI, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
function cut(text, limit) {
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}\u2026` : text;
}
function shortReason(text) {
  const reason = oneLine(SECRETS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), withoutUrlSecrets(text))).replace(/[.\s]+$/, "");
  if (reason === "") return void 0;
  return cut(reason, REASON_LIMIT);
}

// src/tui.ts
import { createSignal } from "solid-js";

// src/constants.ts
var PLUGIN_ID = "affinity.crm";
var SERVER_NAME = "affinity";
var CLIENT_URL = "https://opencode.ai/oauth/opencode/client.json";
var SUPPORTED_HOST = ">=2.2.3 <2.3.0";
var TESTED_HOSTS = ["2.2.3", "2.2.4", "2.2.5", "2.2.6"];
var errorText = (code, message, nextStep) => `${code}: ${message} Next step: ${nextStep}`;

// src/host-version.ts
var RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
var parse = (version) => RELEASE.exec(version)?.slice(1).map(Number);
var [LOWEST, ABOVE] = SUPPORTED_HOST.split(" ").map((bound) => parse(bound.replace(/^[<>]=?/, "")));
var compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function isSupportedHost(version) {
  const parts = parse(version);
  return parts !== void 0 && compare(parts, LOWEST) >= 0 && compare(parts, ABOVE) < 0;
}

// src/affinity-tools.ts
var READ_TOOLS = [
  "get_current_user",
  "search_companies_top_matches",
  "search_all_companies",
  "get_company_info",
  "get_company_list_entries",
  "get_merge_task",
  "render_market_map",
  "get_entity_fields",
  "get_list_fields",
  "get_list_field_dropdown_options",
  "get_entity_field_dropdown_options",
  "get_field_value_changes",
  "get_investor_executive_connections",
  "get_coworker_connections",
  "get_lists",
  "get_single_list_entry",
  "get_list_info",
  "search_list_entries",
  "get_meetings",
  "get_meetings_for_entity",
  "query_notes",
  "get_notes_for_entity",
  "get_entities_attached_to_note",
  "search_notes",
  "get_entity_files",
  "get_entity_file_metadata",
  "search_files",
  "search_opportunities",
  "search_persons",
  "get_person_info",
  "get_persons_info",
  "get_person_list_entries",
  "get_person_relationships",
  "get_company_relationships",
  "get_reminders",
  "get_saved_views",
  "get_saved_view_list_entries",
  "get_transcript_fragments",
  "get_users",
  "render_warm_intro_graph",
  // Affinity's workflow playbooks: each returns Affinity's own instructions for a task as text, not data.
  "affinity_data_migration",
  "affinity_event_setup",
  "affinity_lp_pipeline_brief",
  "affinity_meeting_prep",
  "affinity_missed_deal_review",
  "affinity_reference_check",
  "company_signals",
  "crm_audit",
  "customer_ready_to_raise",
  "market_map_generator",
  "portfolio_attention_score",
  "warm_intro"
];
var WRITE_TOOLS = [
  "create_company",
  "create_field",
  "create_list_field_dropdown_option",
  "create_interaction",
  "create_list",
  // is_public true shares the list with the whole organisation
  "create_list_entry",
  "create_note",
  "create_opportunity",
  "create_person",
  "create_reminder",
  // owner_id can be a colleague
  "issue_entity_files_upload_token",
  // a single-use upload target for a file the user names
  "issue_entity_files_download_token",
  // returns a single-use download credential and a curl command
  "update_company",
  // destructive: person_ids replaces the full set
  "update_list_field_dropdown_option",
  // destructive: renames or restyles an option on every entry
  "upsert_entity_field_values",
  // destructive: overwrites field values
  "upsert_list_entry_field_values",
  // destructive: overwrites field values, such as a deal's stage
  "update_note",
  // destructive: the attachments replace the full sets
  "update_opportunity",
  // destructive: company_ids and person_ids replace the full sets
  "update_person",
  // destructive: emails and company_ids replace the full sets
  "update_reminder"
  // destructive: can reassign a reminder to a colleague
];
var DESTRUCTIVE_TOOLS = [
  "delete_company",
  "delete_person",
  "delete_opportunity",
  "delete_note",
  "delete_list_entries",
  "delete_list_field_dropdown_option",
  "delete_reminder",
  "merge_companies",
  "merge_persons",
  "send_feedback"
];
var ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS];
function classify(name) {
  if (READ_TOOLS.includes(name)) return "read";
  if (WRITE_TOOLS.includes(name)) return "write";
  if (DESTRUCTIVE_TOOLS.includes(name)) return "destructive";
  return "unknown";
}

// src/permissions.ts
var ACCESS = ["all", "ask-changes", "read-only"];
var effectOf = (name, access) => classify(name) === "read" ? "allow" : access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny";
var actionOf = (tool) => `${SERVER_NAME}_${tool}`;
var rule = (tool, effect) => ({ action: actionOf(tool), resource: "*", effect });
var defaultRules = (access = "all") => [
  rule("*", access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"),
  ...ALL_TOOLS.map((tool) => rule(tool, effectOf(tool, access)))
];

// src/status.ts
var SIGN_IN = `Run /connect and choose Affinity, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically, from the project folder where the plugin is installed).`;
var ADMIN_STEP = `If this is the first sign-in here, an Affinity admin must first add OpenCode's client URL, ${CLIENT_URL}, under Settings, Manage Apps, New App, Client URL, with the scopes mcp, mcp.read and offline_access.`;
var agentRules = (access) => defaultRules(access).map((rule2, index, rules) => `  ${JSON.stringify(rule2)}${index < rules.length - 1 ? "," : ""}`).join("\n");
var TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`;
var STATE_TEXT = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict"
};
var NOT_READ = "not read yet";
var GRANT_TEXT = {
  "read-write": "Affinity grant: read and write",
  "read-only": "Affinity grant: read-only, so Affinity refuses changes",
  "api-key": "Affinity grant: API key (full access)"
};
var RULES_NOT_ADDED = "RULES_NOT_ADDED:";
function serverText(source) {
  if (source.type === "plugin") return `${source.url}, registered by this plugin`;
  if (source.type === "adopted") return `${source.url}, your own mcp.servers.${SERVER_NAME}${source.signIn === "own" ? " without OAuth" : ""}, used unchanged`;
  return `your mcp.servers.${SERVER_NAME} points at ${source.url}`;
}
function toolsText({ tools, unknownCount, unknownTools, destructiveTools, listing, access }) {
  if (listing) return "none listed yet (Affinity is still listing them)";
  const posture = destructiveTools.length ? `; ${list(destructiveTools)} ${access === "all" ? "allowed like everything else" : access === "ask-changes" ? "ask" : "denied"}` : "";
  if (unknownCount === 0) return `${tools} available, 0 unknown${posture}`;
  const more = unknownCount - unknownTools.length;
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : "";
  return `${tools} available, ${unknownCount} unknown${names} (a tool Affinity adds is ${access === "all" ? "allowed at once" : access === "ask-changes" ? "asked about" : "denied"})${posture}`;
}
var list = (names) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
var postureOf = (access) => access === "all" ? "every Affinity tool is allowed, reads and changes alike" : access === "ask-changes" ? `reads run without asking; the ${WRITE_TOOLS.length} writes and the ${DESTRUCTIVE_TOOLS.length} destructive tools ask first` : `reads run without asking; the ${WRITE_TOOLS.length} writes and the ${DESTRUCTIVE_TOOLS.length} destructive tools are denied`;
function accessText({ grant, access, problems, unguardedAgents: unguardedAgents2 }) {
  const rules = problems.some((problem) => problem.startsWith(RULES_NOT_ADDED)) ? "default rules not added (see the OpenCode row)" : unguardedAgents2.length ? "default rules missing in the agents listed below" : "every agent has the block";
  return `${grant ? GRANT_TEXT[grant] : `Affinity grant ${NOT_READ}`}; access ${access}: ${postureOf(access)}; ${rules}`;
}
function organisationText({ state, source, adminStep, everConnected }) {
  if (adminStep) return adminStep;
  if (source?.type === "adopted" && source.signIn === "own") return "not needed: your own entry signs in with an API key";
  if (state === "connected") return "done: this Affinity organisation lets OpenCode sign in";
  if (state === "sign_in_required") {
    return everConnected ? "done earlier: the sign-in has expired, so run /connect again" : `once per Affinity organisation, an admin adds OpenCode's client URL, ${CLIENT_URL}, under Settings, Manage Apps`;
  }
  return "not reached yet";
}
function hostText({ host, problems }) {
  const { version, range, tested } = host;
  const outside = version === null || !isSupportedHost(version);
  const notes = [
    ...outside ? [`It is outside the supported range; the plugin runs because allowUntestedHost is true. If Affinity misbehaves, use OpenCode ${TESTED_TEXT}.`] : [],
    ...problems
  ];
  return `${version ?? "unknown version"} (${tested ? "tested" : "untested"}; supported range ${range})${notes.length ? `. ${notes.join(" ")}` : ""}`;
}
function formatStatus(status) {
  const { source, unguardedAgents: agents } = status;
  const details = [status.error, source && serverText(source), status.listing && "still listing its tools"].filter(Boolean).join("; ");
  return [
    "Affinity status",
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Account: ${status.organisation ?? `${NOT_READ} (it appears after the first ${SERVER_NAME}_get_current_user call since OpenCode started)`}`,
    `- Access: ${accessText(status)}`,
    `- Organisation setup: ${organisationText(status)}`,
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${agents.length ? `${agents.join(", ")}
${agentRules(status.access)}` : "none"}`,
    `- OpenCode: ${hostText(status)}`,
    `- Next step: ${status.nextStep}`
  ].join("\n");
}
var strings = { type: "array", items: { type: "string" } };
var count = { type: "integer", minimum: 0 };
var nullableString = { type: ["string", "null"] };
var StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "access", "state", "organisation", "grant", "adminStep", "everConnected", "tools", "destructiveTools", "deniedTools", "listing", "unknownCount", "unknownTools", "unguardedAgents", "host", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          access: { enum: [...ACCESS] },
          state: { enum: ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict"] },
          error: { type: "string" },
          source: {
            type: "object",
            required: ["type", "url"],
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, url: { type: "string" }, expected: { type: "string" }, signIn: { enum: ["oauth", "own"] } }
          },
          organisation: nullableString,
          grant: { enum: ["read-write", "read-only", "api-key", null] },
          adminStep: nullableString,
          everConnected: { type: "boolean" },
          tools: count,
          destructiveTools: strings,
          deniedTools: strings,
          listing: { type: "boolean" },
          unknownCount: count,
          unknownTools: strings,
          unguardedAgents: strings,
          shadowedSkills: {
            type: "array",
            items: { type: "object", required: ["id", "path"], properties: { id: { type: "string" }, path: { type: "string" } } }
          },
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } }
          },
          problems: strings,
          nextStep: { type: "string" }
        }
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } }
    }
  },
  events: {}
};

// src/tui.ts
var TUI_ID = "affinity.crm.tui";
var TITLE = "Affinity status";
var KEYS = "r refresh \xB7 esc close";
function viewMessage(result) {
  return `${reportOf(result)}

${KEYS}`;
}
function reportOf(result) {
  if ("status" in result) return formatStatus(result.status).split("\n").slice(1).join("\n");
  const { error } = result;
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : void 0;
  if (type === "unavailable") {
    const { message, data } = error;
    if (typeof message === "string" && typeof data?.nextStep === "string") return `${message} Next step: ${data.nextStep}`;
  }
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return errorText("STATUS_UNAVAILABLE", "The Affinity plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.");
  }
  const reason = shortReason(typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error));
  return errorText("STATUS_UNAVAILABLE", `Could not read Affinity's status${reason ? ` (${reason})` : ""}.`, "Restart OpenCode, then run /affinity again.");
}
function setupView(context) {
  let open;
  let latest = 0;
  let stops = [];
  const unsubscribe = () => {
    for (const stop of stops.splice(0)) stop();
  };
  const subscribe = () => {
    if (stops.length) return;
    stops = [
      context.data.on("mcp.status.changed", (event) => {
        if (event.data.server === SERVER_NAME) refresh();
      }),
      // Status events can be missed while the TUI is reconnecting.
      context.data.on("server.connected", refresh),
      context.data.on("agent.updated", refresh),
      // Signing in, out or switching accounts changes the account and the sign-in state.
      context.data.on("integration.updated", refresh),
      context.data.on("credential.updated", refresh),
      context.data.on("credential.switched", refresh)
    ];
  };
  const [shown, setShown] = createSignal(false);
  const show = async (refresh2) => {
    if (refresh2 && open === void 0) return;
    const request = ++latest;
    const location = context.location;
    const result = await context.client.rpc(StatusRpc).status({}, location ? { location } : {}).then((status) => ({ status }), (error) => ({ error }));
    if (request !== latest || refresh2 && open === void 0) return;
    open = request;
    setShown(true);
    subscribe();
    void context.ui.dialog.alert({ title: TITLE, message: viewMessage(result) }).then(() => {
      if (open !== request) return;
      open = void 0;
      setShown(false);
      unsubscribe();
    });
    context.ui.dialog.set({ size: "large" });
  };
  const refresh = () => void show(true);
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "affinity.crm.status",
        title: "Affinity: Status",
        description: "Sign-in, account, tools and the next step for Affinity",
        group: "Affinity",
        palette: true,
        slash: { name: "affinity" },
        run: () => show(false)
      },
      { id: "affinity.crm.status.refresh", title: "Refresh Affinity status", group: "Affinity", bind: "r", enabled: shown, run: refresh }
    ]
  }));
  return () => {
    unsubscribe();
    if (open === void 0) return;
    open = void 0;
    setShown(false);
    context.ui.dialog.clear();
  };
}
var tui_default = Plugin.define({ id: TUI_ID, setup: setupView });
export {
  tui_default as default,
  setupView,
  viewMessage
};
