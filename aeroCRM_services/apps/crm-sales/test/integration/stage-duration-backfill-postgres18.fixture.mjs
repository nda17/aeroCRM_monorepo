import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.TZ = "UTC";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const mode = process.argv[2];
assert.ok(["seed", "verify"].includes(mode), "usage: stage-duration-backfill-postgres18.fixture.mjs seed|verify");
assert.equal(process.env.CRM_SALES_STAGE_DURATION_BACKFILL_ALLOW_MUTATION, "true");
const databaseUrl = requiredEnv("CRM_SALES_STAGE_DURATION_BACKFILL_DATABASE_URL");
const expectedRole = requiredEnv("CRM_SALES_STAGE_DURATION_BACKFILL_ROLE");
const url = new URL(databaseUrl);
assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/aerocrm_crm_sales_test_stage_duration");
assert.equal(decodeURIComponent(url.username), expectedRole);
assert.equal(url.searchParams.get("schema"), "crm_sales");

const ids = {
	workspace: "a1000000-0000-4000-8000-000000000001",
	fencedWorkspace: "a1000000-0000-4000-8000-000000000002",
	pipeline: "a2000000-0000-4000-8000-000000000001",
	fencedPipeline: "a2000000-0000-4000-8000-000000000002",
	stageA: "a3000000-0000-4000-8000-000000000001",
	stageB: "a3000000-0000-4000-8000-000000000002",
	stageC: "a3000000-0000-4000-8000-000000000003",
	fencedStage: "a3000000-0000-4000-8000-000000000004",
	created: "a4000000-0000-4000-8000-000000000001",
	transitioned: "a4000000-0000-4000-8000-000000000002",
	sameStage: "a4000000-0000-4000-8000-000000000003",
	noEvidence: "a4000000-0000-4000-8000-000000000004",
	ambiguous: "a4000000-0000-4000-8000-000000000005",
	future: "a4000000-0000-4000-8000-000000000006",
	mismatchedStage: "a4000000-0000-4000-8000-000000000007",
	fenced: "a4000000-0000-4000-8000-000000000008",
};
const instants = {
	createdAt: "2020-01-01T00:00:00.000Z",
	first: "2026-09-20T10:00:00.000Z",
	latest: "2026-09-23T11:00:00.000Z",
	ambiguous: "2026-09-24T12:00:00.000Z",
	future: "2030-01-01T00:00:00.000Z",
};

const client = new Client({ connectionString: databaseUrl, application_name: `stage-duration-backfill-${mode}` });
await client.connect();
try {
	await client.query("SET TIME ZONE 'UTC'");
	if (mode === "seed") await seed();
	else await verify();
} finally {
	await client.end();
}

async function seed() {
	const schema = await client.query(`
		SELECT to_regclass('crm_sales.deals') AS deals,
		       to_regclass('crm_sales.deal_timeline') AS timeline,
		       EXISTS (
		         SELECT 1 FROM pg_attribute
		         WHERE attrelid = 'crm_sales.deals'::regclass
		           AND attname = 'stage_entered_at' AND NOT attisdropped
		       ) AS migrated
	`);
	assert.ok(schema.rows[0].deals && schema.rows[0].timeline, "run after migrations 1-9");
	assert.equal(schema.rows[0].migrated, false, "seed fixture only before stage-duration migration 10");
	await client.query("BEGIN");
	try {
		const existing = await client.query(
			`SELECT count(*)::integer AS count FROM crm_sales.pipelines WHERE id = ANY($1::uuid[])`,
			[[ids.pipeline, ids.fencedPipeline]],
		);
		assert.equal(existing.rows[0].count, 0, "refuse to overwrite pre-existing fixture ids");
		await client.query(
			`INSERT INTO crm_sales.pipelines
			 (id, workspace_id, name, version, template_key, template_version, template_fingerprint, installed_by_subject, created_at, updated_at)
			 VALUES
			 ($1, $2, 'Stage duration backfill fixture', 1, 'fixture', 1, repeat('a', 64), 'stage-duration-fixture', $3, $3),
			 ($4, $5, 'Stage duration fenced fixture', 1, 'fixture', 1, repeat('b', 64), 'stage-duration-fixture', $3, $3)`,
			[ids.pipeline, ids.workspace, instants.createdAt, ids.fencedPipeline, ids.fencedWorkspace],
		);
		await client.query(
			`INSERT INTO crm_sales.pipeline_stages
			 (id, pipeline_id, workspace_id, key, name, position, state, updated_at)
			 VALUES
			 ($1, $2, $3, 'a', 'Stage A', 1, 'OPEN', $9),
			 ($4, $2, $3, 'b', 'Stage B', 2, 'OPEN', $9),
			 ($5, $2, $3, 'c', 'Stage C', 3, 'OPEN', $9),
			 ($6, $7, $8, 'fenced', 'Fenced stage', 1, 'OPEN', $9)`,
			[ids.stageA, ids.pipeline, ids.workspace, ids.stageB, ids.stageC, ids.fencedStage, ids.fencedPipeline, ids.fencedWorkspace, instants.createdAt],
		);
		const deals = [
			[ids.created, ids.workspace, ids.pipeline, ids.stageA],
			[ids.transitioned, ids.workspace, ids.pipeline, ids.stageB],
			[ids.sameStage, ids.workspace, ids.pipeline, ids.stageA],
			[ids.noEvidence, ids.workspace, ids.pipeline, ids.stageA],
			[ids.ambiguous, ids.workspace, ids.pipeline, ids.stageB],
			[ids.future, ids.workspace, ids.pipeline, ids.stageA],
			[ids.mismatchedStage, ids.workspace, ids.pipeline, ids.stageB],
			[ids.fenced, ids.fencedWorkspace, ids.fencedPipeline, ids.fencedStage],
		];
		for (const [id, workspaceId, pipelineId, stageId] of deals)
			await client.query(
				`INSERT INTO crm_sales.deals
				 (id, workspace_id, title, amount_minor, pipeline_id, stage_id, status, contact_id, contact_name, assigned_to_subject, created_at, updated_at)
				 VALUES ($1, $2, 'Historical import', 0, $3, $4, 'OPEN', $5, 'Fixture contact', 'stage-duration-fixture', $6, $6)`,
				[id, workspaceId, pipelineId, stageId, `b4000000-0000-4000-8000-${id.slice(-12)}`, instants.createdAt],
			);
		const event = async (dealId, kind, fromStageId, toStageId, createdAt) =>
			client.query(
				`INSERT INTO crm_sales.deal_timeline
				 (id, workspace_id, deal_id, kind, actor_subject, outcome, from_stage_id, to_stage_id, created_at)
				 VALUES (gen_random_uuid(), $1, $2, $3, 'stage-duration-fixture', 'backfill fixture', $4, $5, $6)`,
				[dealId === ids.fenced ? ids.fencedWorkspace : ids.workspace, dealId, kind, fromStageId, toStageId, createdAt],
			);
		await event(ids.created, "CREATED", null, ids.stageA, instants.first);
		await event(ids.transitioned, "CREATED", null, ids.stageA, instants.first);
		await event(ids.transitioned, "TRANSITIONED", ids.stageA, ids.stageB, instants.latest);
		await event(ids.sameStage, "TRANSITIONED", ids.stageA, ids.stageA, instants.latest);
		await event(ids.ambiguous, "CREATED", null, ids.stageA, instants.first);
		await event(ids.ambiguous, "TRANSITIONED", ids.stageA, ids.stageB, instants.ambiguous);
		await event(ids.ambiguous, "TRANSITIONED", ids.stageA, ids.stageC, instants.ambiguous);
		await event(ids.future, "CREATED", null, ids.stageA, instants.future);
		await event(ids.mismatchedStage, "CREATED", null, ids.stageA, instants.latest);
		await event(ids.fenced, "CREATED", null, ids.fencedStage, instants.latest);
		await client.query(
			`UPDATE crm_sales.workspace_closure_fences
			 SET closure_id = 'a5000000-0000-4000-8000-000000000001', generation = 1,
			     owner_subject = 'stage-duration-fixture', requested_at = $2, fenced_at = $2
			 WHERE workspace_id = $1`,
			[ids.fencedWorkspace, instants.latest],
		);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
	console.log("Stage-duration legacy rows seeded in the isolated scratch database.");
}

async function verify() {
	const schema = await client.query(`
		SELECT EXISTS (
		         SELECT 1 FROM pg_attribute
		         WHERE attrelid = 'crm_sales.deals'::regclass
		           AND attname = 'stage_entered_at' AND NOT attisdropped
		       ) AS migrated,
		       EXISTS (
		         SELECT 1 FROM pg_trigger
		         WHERE tgrelid = 'crm_sales.deals'::regclass
		           AND tgname = 'track_deal_stage_entry' AND NOT tgisinternal
		       ) AS trigger_installed,
		       to_regprocedure('crm_sales.track_deal_stage_entry()') IS NOT NULL AS routine_installed
	`);
	assert.equal(schema.rows[0].migrated, true);
	assert.equal(schema.rows[0].trigger_installed, true);
	assert.equal(schema.rows[0].routine_installed, true);
	const result = await client.query(
		`SELECT id, stage_entered_at FROM crm_sales.deals WHERE id = ANY($1::uuid[])`,
		[[ids.created, ids.transitioned, ids.sameStage, ids.noEvidence, ids.ambiguous, ids.future, ids.mismatchedStage, ids.fenced]],
	);
	const byId = new Map(result.rows.map((row) => [row.id, row.stage_entered_at]));
	assert.equal(byId.get(ids.created)?.toISOString(), instants.first);
	assert.equal(byId.get(ids.transitioned)?.toISOString(), instants.latest);
	for (const id of [ids.sameStage, ids.noEvidence, ids.ambiguous, ids.future, ids.mismatchedStage, ids.fenced])
		assert.equal(byId.get(id), null, `stage entry must remain unknown for ${id}`);
	console.log("Stage-duration backfill behavior verified against the real PostgreSQL schema.");
}

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}
