export const CURRENT_TABLES = {
  opportunities: [["id", "TEXT", 0, null, 1], ["type", "TEXT", 1, null, 0], ["label", "TEXT", 1, null, 0], ["organization", "TEXT", 0, null, 0], ["status", "TEXT", 1, null, 0], ["priority", "TEXT", 1, "'medium'", 0], ["summary", "TEXT", 0, null, 0], ["origin_opportunity_id", "TEXT", 0, null, 0], ["created_at", "TEXT", 1, null, 0], ["updated_at", "TEXT", 1, null, 0]],
  job_opportunity_details: [["opportunity_id", "TEXT", 0, null, 1], ["url", "TEXT", 0, null, 0], ["source", "TEXT", 0, null, 0], ["location", "TEXT", 0, null, 0], ["contact", "TEXT", 0, null, 0], ["applied_date", "TEXT", 0, null, 0]],
  connection_opportunity_details: [["opportunity_id", "TEXT", 0, null, 1], ["role_context", "TEXT", 0, null, 0], ["contact_info", "TEXT", 0, null, 0], ["meeting_context", "TEXT", 0, null, 0], ["relationship_strength", "TEXT", 1, "'new'", 0]],
  opportunity_activities: [["id", "TEXT", 0, null, 1], ["opportunity_id", "TEXT", 1, null, 0], ["type", "TEXT", 1, null, 0], ["body", "TEXT", 1, null, 0], ["metadata_json", "TEXT", 0, null, 0], ["occurred_at", "TEXT", 1, null, 0], ["created_at", "TEXT", 1, null, 0]],
  opportunity_tasks: [["id", "TEXT", 0, null, 1], ["opportunity_id", "TEXT", 1, null, 0], ["title", "TEXT", 1, null, 0], ["due_date", "TEXT", 0, null, 0], ["state", "TEXT", 1, null, 0], ["source_activity_id", "TEXT", 0, null, 0], ["completed_at", "TEXT", 0, null, 0], ["created_at", "TEXT", 1, null, 0], ["updated_at", "TEXT", 1, null, 0]],
  opportunity_artifacts: [["id", "TEXT", 0, null, 1], ["opportunity_id", "TEXT", 1, null, 0], ["type", "TEXT", 1, null, 0], ["title", "TEXT", 1, null, 0], ["file_path", "TEXT", 1, null, 0], ["content_type", "TEXT", 1, "'text/markdown'", 0], ["created_at", "TEXT", 1, null, 0], ["updated_at", "TEXT", 1, null, 0]],
  schema_metadata: [["key", "TEXT", 0, null, 1], ["value", "TEXT", 1, null, 0]]
};

const foreignKeys = {
  opportunities: [["origin_opportunity_id", "opportunities", "id", "SET NULL"]],
  job_opportunity_details: [["opportunity_id", "opportunities", "id", "CASCADE"]],
  connection_opportunity_details: [["opportunity_id", "opportunities", "id", "CASCADE"]],
  opportunity_activities: [["opportunity_id", "opportunities", "id", "CASCADE"]],
  opportunity_tasks: [["opportunity_id", "opportunities", "id", "CASCADE"], ["source_activity_id", "opportunity_activities", "id", "SET NULL"]],
  opportunity_artifacts: [["opportunity_id", "opportunities", "id", "CASCADE"]], schema_metadata: []
};
const namedIndexes = {
  opportunities_status_idx: ["opportunities", [["status", 0]]],
  opportunities_updated_at_idx: ["opportunities", [["updated_at", 1]]],
  opportunity_activities_opportunity_occurred_idx: ["opportunity_activities", [["opportunity_id", 0], ["occurred_at", 0]]],
  opportunity_tasks_opportunity_state_idx: ["opportunity_tasks", [["opportunity_id", 0], ["state", 0]]],
  opportunity_artifacts_opportunity_updated_idx: ["opportunity_artifacts", [["opportunity_id", 0], ["updated_at", 1]]]
};
function pragma(db, query) { return db.prepare(query).all(); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function indexColumns(db, name) { return pragma(db, `PRAGMA index_xinfo('${name}')`).filter((row) => row.key === 1).sort((a, b) => a.seqno - b.seqno).map((row) => [row.name, row.desc]); }

export function assertCurrentOpportunitySchema(db) {
  for (const [table, expected] of Object.entries(CURRENT_TABLES)) {
    const columns = pragma(db, `PRAGMA table_info('${table}')`);
    if (!columns.length) throw new Error(`required table missing: ${table}`);
    const actual = columns.map((row) => [row.name, row.type, row.notnull, row.dflt_value, row.pk]);
    if (!same(actual, expected)) throw new Error(`table column mismatch: ${table}`);
    const actualFks = pragma(db, `PRAGMA foreign_key_list('${table}')`).map((row) => [row.from, row.table, row.to, row.on_delete]).sort((a, b) => a[0].localeCompare(b[0]));
    const expectedFks = [...foreignKeys[table]].sort((a, b) => a[0].localeCompare(b[0]));
    if (!same(actualFks, expectedFks)) throw new Error(`foreign key mismatch: ${table}`);
  }
  for (const [name, [table, expected]] of Object.entries(namedIndexes)) {
    const listed = pragma(db, `PRAGMA index_list('${table}')`).find((row) => row.name === name);
    if (!listed || listed.unique !== 0 || listed.origin !== "c" || listed.partial !== 0 || !same(indexColumns(db, name), expected)) throw new Error(`index mismatch: ${name}`);
  }
  const uniqueArtifact = pragma(db, "PRAGMA index_list('opportunity_artifacts')").some((row) => row.unique === 1 && row.partial === 0 && same(indexColumns(db, row.name), [["opportunity_id", 0], ["type", 0], ["file_path", 0]]));
  if (!uniqueArtifact) throw new Error("unique artifact index missing");
  return true;
}
