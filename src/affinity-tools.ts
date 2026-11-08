// Every fact the plugin keeps about Affinity's tools: their names, without the `affinity_` server prefix, sorted by
// what they do. The default rules, the tools RPC's methods, status's unknown tools and the tests all derive from
// these lists; `jelly.tools` in package.json and the skills' call examples are checked against them. Keep this file
// free of runtime imports.
//
// Affinity lists the same tools to every caller: access differences (Deal Assist, unified events, a read-only grant)
// show as errors on call, not as missing tools. So a known tool missing from a live list was removed by a release.
//
// The lists are provisional: they come from Affinity's own server package, affinity-mcp 0.7.1, read without running
// it, and test/unit/affinity-tools-list.json records them in the drift script's research form, which the drift test
// pins. When a live tool list exists, reconciling is a data change: run `npm run drift -- <live list>`, then update
// these lists, PARAMETERS and that file, package.json's jelly.tools and any skill example the report names.

/**
 * Known reads (Affinity's readOnlyHint is true). They run without asking. `get_current_user` is the account read: the
 * organisation's name and the grant's scopes, which status shows once the model or a script has called it.
 */
export const READ_TOOLS: readonly string[] = [
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
  "warm_intro",
]

/**
 * Affinity's workflow playbooks, a subset of READ_TOOLS. Their text tells the model which tools to call next, and some
 * suggest web searches or changes; the affinity skill's rules win over it. This is also the one record of the twelve,
 * which the namespace text, OpenCode's `/affinity:<name>` commands and the tests all refer to.
 */
export const WORKFLOW_TOOLS: readonly string[] = [
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
  "warm_intro",
]

/**
 * Known writes: they ask before they run. Every one changes the firm's shared CRM, which colleagues see, or issues a
 * file credential. Affinity marks the update_* and upsert_* tools destructive, because they overwrite.
 */
export const WRITE_TOOLS: readonly string[] = [
  "create_company",
  "create_field",
  "create_list_field_dropdown_option",
  "create_interaction",
  "create_list", // is_public true shares the list with the whole organisation
  "create_list_entry",
  "create_note",
  "create_opportunity",
  "create_person",
  "create_reminder", // owner_id can be a colleague
  "issue_entity_files_upload_token", // a single-use upload target for a file the user names
  "issue_entity_files_download_token", // returns a single-use download credential and a curl command
  "update_company", // destructive: person_ids replaces the full set
  "update_list_field_dropdown_option", // destructive: renames or restyles an option on every entry
  "upsert_entity_field_values", // destructive: overwrites field values
  "upsert_list_entry_field_values", // destructive: overwrites field values, such as a deal's stage
  "update_note", // destructive: the attachments replace the full sets
  "update_opportunity", // destructive: company_ids and person_ids replace the full sets
  "update_person", // destructive: emails and company_ids replace the full sets
  "update_reminder", // destructive: can reassign a reminder to a colleague
]

/**
 * Off by default; a deny also hides them. A user turns one back on with an `ask` rule in a named agent's own
 * permissions, never top level (docs/configuration.md).
 * - The seven deletes and two merges remove CRM data permanently (a merge deletes the duplicate; a merge with a global
 *   company can't be undone). delete_reminder and delete_list_field_dropdown_option have no confirmation step.
 * - `send_feedback` sends text to Affinity's team, and Affinity's server instructions tell the model to offer it
 *   whenever a request can't be done.
 */
export const DESTRUCTIVE_TOOLS: readonly string[] = [
  "delete_company",
  "delete_person",
  "delete_opportunity",
  "delete_note",
  "delete_list_entries",
  "delete_list_field_dropdown_option",
  "delete_reminder",
  "merge_companies",
  "merge_persons",
  "send_feedback",
]

/**
 * Each known tool's input parameters, as `name:type`, with `*` after a required name, in the input schema's order.
 * Types read as a JSON Schema gives them: `array<integer>|null` is an optional list of integers. A name without a type
 * takes one of Affinity's own models or enums (search criteria, field ids, entity types), which the live schemas will
 * give. The drift script compares a saved tool list with this record, and the skills test checks every literal call in
 * a skill against it. Affinity rejects an argument a tool does not declare.
 */
export const PARAMETERS: Readonly<Record<string, readonly string[]>> = {
  affinity_data_migration: ["file:string|null"],
  affinity_event_setup: ["file:string|null"],
  affinity_lp_pipeline_brief: ["file:string|null"],
  affinity_meeting_prep: ["file:string|null"],
  affinity_missed_deal_review: ["file:string|null"],
  affinity_reference_check: ["file:string|null"],
  company_signals: ["file:string|null"],
  create_company: ["name*:string", "domain:string|null", "person_ids:array<integer>|null"],
  create_field: ["name*:string", "value_type*", "entity_type*", "list_id:integer|null", "allows_multiple:boolean", "is_required:boolean"],
  create_interaction: ["interaction_type*", "date*:string", "person_ids*:array<integer>", "content*:string", "direction"],
  create_list: ["name*:string", "entity_type*", "is_public:boolean"],
  create_list_entry: ["list_id*:integer", "entity_id*:integer"],
  create_list_field_dropdown_option: ["list_id*:integer", "field_id*", "option_type*", "text*:string", "rank:integer|null", "color", "status_category", "win_rate:integer|null"],
  create_note: ["note_type*", "content*:string", "person_ids:array<integer>|null", "company_ids:array<integer>|null", "opportunity_ids:array<integer>|null", "meeting_id:integer|null", "parent_note_id:integer|null"],
  create_opportunity: ["name*:string", "list_id*:integer", "company_ids:array<integer>|null", "person_ids:array<integer>|null"],
  create_person: ["first_name*:string", "last_name*:string", "emails*:array<string>", "company_ids:array<integer>|null"],
  create_reminder: ["owner_id*:integer", "reminder_type*", "entity_id*:integer", "entity_type*", "content:string|null", "due_date:string|null", "reset_type", "reminder_days:integer|null", "is_completed:boolean|null"],
  crm_audit: ["file:string|null"],
  customer_ready_to_raise: ["file:string|null"],
  delete_company: ["company_ids*", "confirm:boolean"],
  delete_list_entries: ["list_id*:integer", "list_entry_ids*", "confirm:boolean"],
  delete_list_field_dropdown_option: ["list_id*:integer", "field_id*", "dropdown_option_id*:integer"],
  delete_note: ["note_ids*", "confirm:boolean"],
  delete_opportunity: ["opportunity_ids*", "confirm:boolean"],
  delete_person: ["person_ids*", "confirm:boolean"],
  delete_reminder: ["reminder_id*:integer"],
  get_company_info: ["company_id*:integer", "field_ids:array<string>|null", "field_types"],
  get_company_list_entries: ["company_id*:integer", "cursor:string|null", "limit:integer"],
  get_company_relationships: ["company_id*:integer", "cursor:string|null", "limit:integer", "filter_expr:string|null", "order_by:string|null", "total_count:boolean"],
  get_coworker_connections: ["company_id*:integer", "cursor:string|null", "limit:integer", "total_count:boolean"],
  get_current_user: [],
  get_entities_attached_to_note: ["note_id*:integer", "entity_type*", "cursor:string|null", "limit:integer", "total_count:boolean"],
  get_entity_field_dropdown_options: ["entity_type*", "field_id*", "cursor:string|null", "limit:integer"],
  get_entity_fields: ["entity_type*", "cursor:string|null", "limit:integer", "filter:string|null", "includes"],
  get_entity_file_metadata: ["file_id*:integer"],
  get_entity_files: ["entity_id:integer|null", "entity_type", "page_token:string|null", "page_size:integer"],
  get_field_value_changes: ["cursor:string|null", "limit:integer", "filter_expr:string|null", "order_by:string|null"],
  get_investor_executive_connections: ["company_id*:integer", "cursor:string|null", "limit:integer", "total_count:boolean"],
  get_list_field_dropdown_options: ["list_id*:integer", "field_id*", "cursor:string|null", "limit:integer"],
  get_list_fields: ["list_id*:integer", "cursor:string|null", "limit:integer", "filter:string|null", "includes"],
  get_list_info: ["list_id*:integer"],
  get_lists: ["term:string|null", "cursor:string|null", "limit:integer"],
  get_meetings: ["filter_expr:string|null", "cursor:string|null", "limit:integer"],
  get_meetings_for_entity: ["entity_id*:integer", "entity_type*", "start_time*", "end_time*", "internal_person_id:integer|null", "logging_type", "page_size:integer", "page_token:string|null"],
  get_merge_task: ["task_id*:string", "entity_type*"],
  get_notes_for_entity: ["entity_id*:integer", "entity_type*", "filter_expr:string|null", "cursor:string|null", "limit:integer", "total_count:boolean"],
  get_person_info: ["person_id*:integer", "field_ids:array<string>|null", "field_types"],
  get_person_list_entries: ["person_id*:integer", "cursor:string|null", "limit:integer"],
  get_person_relationships: ["person_id*:integer", "cursor:string|null", "limit:integer", "filter_expr:string|null", "order_by:string|null", "total_count:boolean"],
  get_persons_info: ["person_ids*:array<integer>", "field_ids:array<string>|null", "field_types", "cursor:string|null", "limit:integer", "total_count:boolean"],
  get_reminders: ["entity_id:integer|null", "entity_type", "creator_id:integer|null", "owner_id:integer|null", "completer_id:integer|null", "reminder_type", "reset_type", "status", "due_before:string|null", "due_after:string|null", "page_size:integer", "page_token:string|null"],
  get_saved_view_list_entries: ["list_id*:integer", "view_id*:integer", "cursor:string|null", "limit:integer"],
  get_saved_views: ["list_id*:integer", "cursor:string|null", "limit:integer"],
  get_single_list_entry: ["list_id*:integer", "list_entry_id*:integer", "field_ids:array<string>|null", "field_types"],
  get_transcript_fragments: ["transcript_id*:integer", "cursor:string|null", "limit:integer"],
  get_users: ["term:string|null", "filter_expr:string|null", "cursor:string|null", "limit:integer"],
  issue_entity_files_download_token: ["file_id*:integer"],
  issue_entity_files_upload_token: ["entity_id*:integer", "entity_type*", "filename*:string", "filesize*:integer", "content_type*:string"],
  market_map_generator: ["file:string|null"],
  merge_companies: ["primary_company_id*:integer", "duplicate_company_id*:integer", "confirm:boolean"],
  merge_persons: ["primary_person_id*:integer", "duplicate_person_id*:integer", "confirm:boolean"],
  portfolio_attention_score: ["file:string|null"],
  query_notes: ["filter_expr:string|null", "cursor:string|null", "limit:integer"],
  render_market_map: ["thesis*", "your_companies*", "explore_companies*"],
  render_warm_intro_graph: ["team*", "targets*", "edges*"],
  search_all_companies: ["search_criteria", "field_ids:array<string>|null", "field_types", "cursor:string|null", "limit:integer", "total_count:boolean"],
  search_companies_top_matches: ["query:string|null", "search_criteria", "list_ids:array<integer>|null", "limit:integer"],
  search_files: ["prompt*:string", "file_ids:array<integer>|null", "company_id:integer|null", "limit:integer"],
  search_list_entries: ["list_id*:integer", "search_criteria", "field_ids:array<string>|null", "field_types", "cursor:string|null", "limit:integer", "total_count:boolean"],
  search_notes: ["prompt*:string", "note_ids:array<integer>|null", "company_id:integer|null", "limit:integer"],
  search_opportunities: ["term:string|null", "page_size:integer|null", "page_token:string|null"],
  search_persons: ["search_criteria", "field_ids:array<string>|null", "field_types", "cursor:string|null", "limit:integer", "total_count:boolean"],
  send_feedback: ["subject*:string", "body*:string"],
  update_company: ["company_id*:integer", "name:string|null", "domain:string|null", "person_ids:array<integer>|null"],
  update_list_field_dropdown_option: ["list_id*:integer", "field_id*", "dropdown_option_id*:integer", "text:string|null", "rank:integer|null", "color", "status_category", "win_rate:integer|null"],
  update_note: ["note_id*:integer", "content:string|null", "person_ids:array<integer>|null", "company_ids:array<integer>|null", "opportunity_ids:array<integer>|null"],
  update_opportunity: ["opportunity_id*:integer", "name:string|null", "company_ids:array<integer>|null", "person_ids:array<integer>|null"],
  update_person: ["person_id*:integer", "first_name:string|null", "last_name:string|null", "emails:array<string>|null", "company_ids:array<integer>|null"],
  update_reminder: ["reminder_id*:integer", "owner_id:integer|null", "reminder_type", "content:string|null", "due_date:string|null", "reset_type", "reminder_days:integer|null", "is_completed:boolean|null"],
  upsert_entity_field_values: ["entity_type*", "entity_id*:integer", "upserts*"],
  upsert_list_entry_field_values: ["list_id*:integer", "list_entry_id*:integer", "upserts*"],
  warm_intro: ["file:string|null"],
}

/** Every known tool, in the order the default rules list them: the reads and playbooks, then the writes and the
 * destructive class. */
export const ALL_TOOLS: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]

type ToolClass = "read" | "write" | "destructive" | "unknown"

export function classify(name: string): ToolClass {
  if (READ_TOOLS.includes(name)) return "read"
  if (WRITE_TOOLS.includes(name)) return "write"
  if (DESTRUCTIVE_TOOLS.includes(name)) return "destructive"
  return "unknown"
}
