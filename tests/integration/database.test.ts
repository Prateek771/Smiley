import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool, PoolClient } from "pg";
import type { SyntheticSeedIds } from "../../src/server/db/seed";

let appPool: Pool;
let migrationPool: Pool;
let closePools: () => Promise<void>;
let migrateDatabase: (pool?: Pool) => Promise<void>;
let seedSynthetic: (pool?: Pool) => Promise<SyntheticSeedIds>;
let ids: SyntheticSeedIds;

before(async () => {
  process.env.NODE_ENV = "test";
  ({ appPool, migrationPool, closePools } = await import("../../src/server/db/client"));
  ({ migrateDatabase } = await import("../../src/server/db/migrate"));
  ({ seedSynthetic } = await import("../../src/server/db/seed"));
  const configured = process.env.TEST_MIGRATION_DATABASE_URL;
  assert.ok(configured, "Explicit test migration URL is required");
  assert.match(new URL(configured).pathname, /_test$/);
  const result = await migrationPool.query("SELECT current_database() AS name");
  assert.match(result.rows[0].name, /_test$/, "Database tests cannot write a non-test database");
});

after(async () => {
  if (closePools) {
    await closePools();
  }
});

async function transaction(action: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await migrationPool.connect();
  try {
    await client.query("BEGIN");
    await action(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function denied(client: PoolClient, statement: string, parameters: unknown[], code: string): Promise<void> {
  await client.query("SAVEPOINT expected_denial");
  let caught: unknown;
  try {
    await client.query(statement, parameters);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT expected_denial");
  assert.ok(caught, "Invalid database write unexpectedly succeeded");
  assert.equal((caught as { code?: string }).code, code);
}

async function claim(client: PoolClient, suffix = randomUUID()): Promise<string> {
  const result = await client.query<{ id: string }>("INSERT INTO claims(hospital_id,branch_id,patient_id,patient_insurance_id,encounter_id,claim_no,claim_type) VALUES($1,$2,$3,$4,$5,$6,'CASHLESS') RETURNING claim_id::text AS id", [ids.hospitals.a, ids.branches.aCentral, ids.patients.a, ids.memberships.a, ids.encounters.a, `SYN-TEST-${suffix}`]);
  return result.rows[0].id;
}

async function actor(client: PoolClient): Promise<string> {
  const authId = randomUUID();
  await client.query("INSERT INTO auth_user(id,name,email) VALUES($1,'Synthetic database actor',$2)", [authId, `db-${authId}@example.invalid`]);
  const result = await client.query<{ id: string }>("INSERT INTO users(hospital_id,auth_user_id,username) VALUES($1,$2,$3) RETURNING user_id::text AS id", [ids.hospitals.a, authId, `SYN-DB-${authId}`]);
  return result.rows[0].id;
}

test("foundation/additive preservation or tracked migration repeat preserves an exact claim", async (context) => {
  const ledger = await migrationPool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
  const applied = ledger.rows[0].name ? await migrationPool.query("SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations") : null;
  if (!applied || applied.rows[0].count === 0) {
    const count = await migrationPool.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    assert.equal(count.rows[0].count, 0, "Only an empty untracked test database can be initialized");
    const folder = await mkdtemp(path.join(tmpdir(), "smiley-first-migration-"));
    try {
      await mkdir(path.join(folder, "meta"));
      const journal = JSON.parse(await readFile(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
      journal.entries = [journal.entries[0]];
      await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify(journal));
      await copyFile(path.join(process.cwd(), `drizzle/${journal.entries[0].tag}.sql`), path.join(folder, `${journal.entries[0].tag}.sql`));
      await migrate(drizzle(migrationPool), { migrationsFolder: folder });
    } finally {
      assert.ok(path.resolve(folder).startsWith(path.resolve(tmpdir()) + path.sep));
      await rm(folder, { recursive: true, force: true });
    }
    ids = await seedSynthetic(migrationPool);
    await migrationPool.query("INSERT INTO claims(hospital_id,branch_id,patient_id,patient_insurance_id,encounter_id,claim_no,claim_type,claimed_amount) VALUES($1,$2,$3,$4,$5,'SYN-MIGRATION-PRESERVATION','CASHLESS','123.45')", [ids.hospitals.a, ids.branches.aCentral, ids.patients.a, ids.memberships.a, ids.encounters.a]);
    const absent = await migrationPool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='claims' AND column_name='version'");
    assert.equal(absent.rowCount, 0, "The first checkpoint must precede the additive case version field");
    context.diagnostic("Fresh empty database: inserted claim before the additive migration and verified version was absent.");
  } else {
    ids = await seedSynthetic(migrationPool);
    await migrationPool.query("INSERT INTO claims(hospital_id,branch_id,patient_id,patient_insurance_id,encounter_id,claim_no,claim_type,claimed_amount) VALUES($1,$2,$3,$4,$5,'SYN-MIGRATION-PRESERVATION','CASHLESS','123.45') ON CONFLICT(claim_no) DO NOTHING", [ids.hospitals.a, ids.branches.aCentral, ids.patients.a, ids.memberships.a, ids.encounters.a]);
    context.diagnostic("Tracked database repeat: checked migration idempotence and preserved/created a synthetic sentinel; this path does not prove fresh additive migration.");
  }
  await migrateDatabase(migrationPool);
  ids = await seedSynthetic(migrationPool);
  const preserved = await migrationPool.query("SELECT claimed_amount,version FROM claims WHERE claim_no='SYN-MIGRATION-PRESERVATION'");
  assert.equal(preserved.rows[0].claimed_amount, "123.45");
  assert.equal(preserved.rows[0].version, 1);
  const role = await appPool.query("SELECT r.rolsuper,r.rolbypassrls,pg_get_userbyid(c.relowner)=current_user AS owns FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname=current_user AND c.oid='claims'::regclass");
  assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: false, owns: false });
});

test("migrations and synthetic seeds are idempotent without resetting rows", async () => {
  const beforeIds = ids;
  const before = await migrationPool.query("SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations");
  await migrateDatabase(migrationPool);
  const secondIds = await seedSynthetic(migrationPool);
  const after = await migrationPool.query("SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations");
  assert.deepEqual(secondIds, beforeIds);
  assert.equal(after.rows[0].count, before.rows[0].count);
  const hospitals = await migrationPool.query("SELECT count(*)::integer AS count FROM hospitals WHERE hospital_code IN('SYN-A','SYN-B')");
  assert.equal(hospitals.rows[0].count, 2);
});

test("all source tables, enums, eight indexes and four invoker views exist", async () => {
  const inventory = JSON.parse(await readFile(path.join(process.cwd(), "docs/schema/domain-inventory.json"), "utf8"));
  const tables = await migrationPool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  assert.equal(tables.rowCount, 52);
  for (const table of inventory.tables) {
    assert.ok(tables.rows.some((row) => row.table_name === table.name), `Missing source table ${table.name}`);
    const columns = await migrationPool.query("SELECT column_name,data_type,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table.name]);
    for (const column of table.columns) {
      if (table.name === "users" && column.name === "password_hash") {
        assert.ok(!columns.rows.some((row) => row.column_name === column.name));
      } else {
        const actual = columns.rows.find((row) => row.column_name === column.name);
        assert.ok(actual, `Missing source column ${table.name}.${column.name}`);
        if (column.postgresql.type === "TIMESTAMP") {
          assert.equal(actual.data_type, "timestamp with time zone");
        }
        if (column.postgresql.identity) {
          assert.equal(actual.column_default, null, "Identity syntax must not become a DEFAULT AS clause");
        }
      }
    }
  }
  const constraints = await migrationPool.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='c'");
  for (const expected of inventory.enum_restorations) {
    const actual = constraints.rows.find((row) => row.conname === expected.constraint_name);
    assert.ok(actual, `Missing enum validation ${expected.constraint_name}`);
    for (const value of expected.allowed_values) {
      assert.ok(actual.definition.includes(`'${value}'`));
    }
  }
  assert.equal(inventory.enum_restorations.length, 52);
  const indexes = await migrationPool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'");
  for (const index of inventory.secondary_index_restorations) {
    assert.ok(indexes.rows.some((row) => row.indexname === index.name));
  }
  const views = await migrationPool.query("SELECT relname,reloptions FROM pg_class WHERE relkind='v' AND relnamespace='public'::regnamespace");
  assert.equal(views.rowCount, 4);
  for (const view of views.rows) {
    assert.ok(view.reloptions.includes("security_invoker=true"));
    await appPool.query(`SELECT * FROM "${view.relname}" LIMIT 1`);
  }
});

test("invalid lifecycle, percentage and monetary values are rejected", async () => {
  await transaction(async (client) => {
    await denied(client, "INSERT INTO hospitals(hospital_code,hospital_name,status) VALUES($1,'Synthetic invalid','BANANA')", [`SYN-${randomUUID().slice(0, 12)}`], "23514");
    await denied(client, "UPDATE insurance_policies SET policy_type='IMAGINARY' WHERE policy_id=$1", [ids.payer.policy], "23514");
    await denied(client, "UPDATE insurance_policies SET copay_percent=101 WHERE policy_id=$1", [ids.payer.policy], "23514");
    const id = await claim(client);
    await denied(client, "UPDATE claims SET claim_stage='FAKE' WHERE claim_id=$1", [id], "23514");
    await denied(client, "UPDATE claims SET claimed_amount=-1 WHERE claim_id=$1", [id], "23514");
    const values = await client.query("SELECT estimated_amount,approved_amount,patient_payable_amount FROM claims WHERE claim_id=$1", [id]);
    assert.deepEqual(values.rows[0], { estimated_amount: null, approved_amount: null, patient_payable_amount: null });
  });
});

test("numeric amounts and quantities must be finite while unknown nullable amounts remain valid", async () => {
  await transaction(async (client) => {
    const id = await claim(client);
    const service = await client.query("INSERT INTO treatment_services(service_code,service_name,service_category) VALUES($1,'Synthetic finite service','OTHER') RETURNING service_id::text AS id", [`SYN-FIN-${randomUUID().slice(0, 12)}`]);
    const cases = [
      { statement: "UPDATE claims SET claimed_amount='NaN'::numeric WHERE claim_id=$1", parameters: [id] },
      { statement: "INSERT INTO encounter_services(hospital_id,branch_id,encounter_id,service_id,service_date,quantity,unit_charge,net_amount) VALUES($1,$2,$3,$4,now(),'NaN'::numeric,1.00,1.00)", parameters: [ids.hospitals.a, ids.branches.aCentral, ids.encounters.a, service.rows[0].id] },
    ];
    const codes: Array<string | undefined> = [];
    for (const { statement, parameters } of cases) {
      await client.query("SAVEPOINT finite_numeric");
      try {
        await client.query(statement, parameters);
        codes.push(undefined);
      } catch (error) {
        codes.push((error as { code?: string }).code);
      }
      await client.query("ROLLBACK TO SAVEPOINT finite_numeric");
    }
    assert.deepEqual(codes, ["23514", "23514"], "Amounts and quantities must reject NaN");
    await client.query("UPDATE claims SET claimed_amount=NULL WHERE claim_id=$1", [id]);
    const unknown = await client.query("SELECT claimed_amount FROM claims WHERE claim_id=$1", [id]);
    assert.equal(unknown.rows[0].claimed_amount, null);
    const columns = await client.query("SELECT c.table_name,c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema='public' AND c.data_type='numeric' AND t.table_type='BASE TABLE'");
    for (const column of columns.rows) {
      const definition = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname=$1", [`ck_${column.table_name}_${column.column_name}_finite`]);
      assert.equal(definition.rowCount, 1, `Missing finite constraint for ${column.table_name}.${column.column_name}`);
      for (const value of ["NaN", "Infinity", "-Infinity"]) {
        assert.ok(definition.rows[0].definition.includes(value));
      }
    }
  });
});

test("audit and login branch attribution requires the matching hospital", async () => {
  await transaction(async (client) => {
    const statements = [
      "INSERT INTO audit_logs(branch_id,module_name,action_name) VALUES($1,'SYNTHETIC','TEST')",
      "INSERT INTO login_logs(branch_id) VALUES($1)",
    ];
    const codes: Array<string | undefined> = [];
    for (const statement of statements) {
      await client.query("SAVEPOINT branch_attribution");
      try {
        await client.query(statement, [ids.branches.aCentral]);
        codes.push(undefined);
      } catch (error) {
        codes.push((error as { code?: string }).code);
      }
      await client.query("ROLLBACK TO SAVEPOINT branch_attribution");
    }
    assert.deepEqual(codes, ["23514", "23514"], "Neither log may carry a branch without its hospital");
    await client.query("INSERT INTO audit_logs(hospital_id,branch_id,module_name,action_name) VALUES($1,$2,'SYNTHETIC','TEST')", [ids.hospitals.a, ids.branches.aCentral]);
    await client.query("INSERT INTO login_logs(hospital_id,branch_id) VALUES($1,$2)", [ids.hospitals.a, ids.branches.aCentral]);
    await client.query("INSERT INTO audit_logs(module_name,action_name) VALUES('SYNTHETIC_SYSTEM','TEST')");
    await client.query("INSERT INTO login_logs(login_status) VALUES('FAILED')");
  });
});

test("five repaired uniqueness grains reject duplicate records", async () => {
  await transaction(async (client) => {
    await client.query("INSERT INTO departments(hospital_id,department_code,department_name) VALUES($1,'SYN-DUP','Synthetic')", [ids.hospitals.a]);
    await denied(client, "INSERT INTO departments(hospital_id,department_code,department_name) VALUES($1,'SYN-DUP','Synthetic')", [ids.hospitals.a], "23505");
    await client.query("INSERT INTO staff(hospital_id,employee_code,first_name) VALUES($1,'SYN-DUP','Synthetic')", [ids.hospitals.a]);
    await denied(client, "INSERT INTO staff(hospital_id,employee_code,first_name) VALUES($1,'SYN-DUP','Synthetic')", [ids.hospitals.a], "23505");
    await denied(client, "INSERT INTO patients(hospital_id,patient_code,first_name) VALUES($1,'SYN-PAT-A','Synthetic')", [ids.hospitals.a], "23505");
    await denied(client, "INSERT INTO insurance_subcategories(insurance_category_id,subcategory_code,subcategory_name) SELECT insurance_category_id,'INDIVIDUAL','Synthetic' FROM insurance_categories WHERE category_code='PRIVATE'", [], "23505");
    await denied(client, "INSERT INTO patient_insurance(hospital_id,patient_id,policy_id,policy_number) VALUES($1,$2,$3,'SYN-POL-A')", [ids.hospitals.a, ids.patients.a, ids.payer.policy], "23505");
  });
});

test("claim membership, patient, branch and encounter must describe one case", async () => {
  await transaction(async (client) => {
    const insert = "INSERT INTO claims(hospital_id,branch_id,patient_id,patient_insurance_id,encounter_id,claim_no,claim_type) VALUES($1,$2,$3,$4,$5,$6,'CASHLESS')";
    const valid = [ids.hospitals.a, ids.branches.aCentral, ids.patients.a, ids.memberships.a, ids.encounters.a];
    for (const change of [
      { index: 1, value: ids.branches.bCentral },
      { index: 3, value: ids.memberships.aOther },
      { index: 3, value: ids.memberships.b },
      { index: 4, value: ids.encounters.aOther },
      { index: 4, value: ids.encounters.aNorth },
    ]) {
      const values = [...valid];
      values[change.index] = change.value;
      await denied(client, insert, [...values, `SYN-BAD-${randomUUID()}`], "23503");
    }
    await client.query(insert, [...valid, `SYN-VALID-${randomUUID()}`]);
    await client.query(insert, [...valid.slice(0, 4), null, `SYN-OPTIONAL-${randomUUID()}`]);
  });
});

test("query submission and workflow patient must match the linked claim", async () => {
  await transaction(async (client) => {
    const one = await claim(client);
    const two = await claim(client);
    const submission = await client.query("INSERT INTO claim_submissions(hospital_id,branch_id,claim_id,submission_no,submitted_to) VALUES($1,$2,$3,$4,'INSURER') RETURNING submission_id::text AS id", [ids.hospitals.a, ids.branches.aCentral, one, `SYN-SUB-${randomUUID()}`]);
    await denied(client, "INSERT INTO claim_queries(hospital_id,branch_id,claim_id,submission_id,query_no,query_text) VALUES($1,$2,$3,$4,$5,'Synthetic question')", [ids.hospitals.a, ids.branches.aCentral, two, submission.rows[0].id, `SYN-QUERY-${randomUUID()}`], "23503");
    const workflow = await client.query("SELECT workflow_id::text AS id FROM workflow_definitions WHERE workflow_code='ELIGIBILITY_CHECK'");
    await denied(client, "INSERT INTO workflow_runs(hospital_id,branch_id,workflow_id,claim_id,patient_id) VALUES($1,$2,$3,$4,$5)", [ids.hospitals.a, ids.branches.aCentral, workflow.rows[0].id, one, ids.patients.aOther], "23503");
    await denied(client, "INSERT INTO workflow_runs(hospital_id,branch_id,workflow_id,claim_id) VALUES($1,$2,$3,$4)", [ids.hospitals.a, ids.branches.aCentral, workflow.rows[0].id, one], "23514");
  });
});

test("invoice and claim cannot silently use different encounters of the same patient", async () => {
  await transaction(async (client) => {
    const id = await claim(client);
    const other = await client.query("INSERT INTO encounters(hospital_id,branch_id,patient_id,encounter_no) VALUES($1,$2,$3,$4) RETURNING encounter_id::text AS id", [ids.hospitals.a, ids.branches.aCentral, ids.patients.a, `SYN-ENC-${randomUUID()}`]);
    await denied(client, "INSERT INTO invoices(hospital_id,branch_id,patient_id,claim_id,encounter_id,invoice_no) VALUES($1,$2,$3,$4,$5,$6)", [ids.hospitals.a, ids.branches.aCentral, ids.patients.a, id, other.rows[0].id, `SYN-INV-${randomUUID()}`], "23514");
    await client.query("INSERT INTO invoices(hospital_id,branch_id,patient_id,claim_id,encounter_id,invoice_no) VALUES($1,$2,$3,$4,$5,$6)", [ids.hospitals.a, ids.branches.aCentral, ids.patients.a, id, ids.encounters.a, `SYN-INV-${randomUUID()}`]);
    await denied(client, "UPDATE claims SET encounter_id=$1 WHERE claim_id=$2", [other.rows[0].id, id], "23514");
  });
});

test("auth links, hospital staff and exact branch roles cannot cross ownership", async () => {
  await transaction(async (client) => {
    const user = await actor(client);
    const linked = await client.query("SELECT auth_user_id FROM users WHERE user_id=$1", [user]);
    await denied(client, "INSERT INTO users(hospital_id,auth_user_id,username) VALUES($1,$2,$3)", [ids.hospitals.a, linked.rows[0].auth_user_id, `SYN-${randomUUID()}`], "23505");
    await denied(client, "INSERT INTO users(hospital_id,username) VALUES($1,$2)", [ids.hospitals.a, `SYN-${randomUUID()}`], "23514");
    await client.query("INSERT INTO user_roles(hospital_id,user_id,role_id) VALUES($1,$2,$3)", [ids.hospitals.a, user, ids.roles.INSURANCE_EXECUTIVE]);
    await denied(client, "INSERT INTO user_branch_memberships(hospital_id,user_id,branch_id,role_id) VALUES($1,$2,$3,$4)", [ids.hospitals.a, user, ids.branches.bCentral, ids.roles.INSURANCE_EXECUTIVE], "23503");
    await denied(client, "INSERT INTO user_branch_memberships(hospital_id,user_id,branch_id,role_id) VALUES($1,$2,$3,$4)", [ids.hospitals.a, user, ids.branches.aCentral, ids.roles.BILLING_OFFICER], "23503");
    await client.query("INSERT INTO user_branch_memberships(hospital_id,user_id,branch_id,role_id) VALUES($1,$2,$3,$4)", [ids.hospitals.a, user, ids.branches.aCentral, ids.roles.INSURANCE_EXECUTIVE]);
  });
});

test("history is immutable, duplicate event keys fail and deleting a parent retains evidence", async () => {
  await transaction(async (client) => {
    const user = await actor(client);
    const id = await claim(client);
    const event = randomUUID();
    const insert = "INSERT INTO claim_events(event_id,hospital_id,branch_id,claim_id,actor_user_id,event_type,occurred_at,idempotency_key,fingerprint,case_version) VALUES($1,$2,$3,$4,$5,'TEST',now(),'SYN-IDEMPOTENT','test',1)";
    await client.query(insert, [event, ids.hospitals.a, ids.branches.aCentral, id, user]);
    await denied(client, insert, [randomUUID(), ids.hospitals.a, ids.branches.aCentral, id, user], "23505");
    await denied(client, "UPDATE claim_events SET event_type='REWRITTEN' WHERE event_id=$1", [event], "42501");
    await denied(client, "DELETE FROM claim_events WHERE event_id=$1", [event], "42501");
    await denied(client, "DELETE FROM claims WHERE claim_id=$1", [id], "23503");
    const audit = await client.query("INSERT INTO audit_logs(hospital_id,user_id,module_name,action_name) VALUES($1,$2,'Synthetic','TEST') RETURNING audit_id::text AS id", [ids.hospitals.a, user]);
    await denied(client, "UPDATE audit_logs SET action_name='REWRITE' WHERE audit_id=$1", [audit.rows[0].id], "42501");
  });
});

test("all five source updated_at fields are maintained by real database writes", async () => {
  await transaction(async (client) => {
    const user = await actor(client);
    const id = await claim(client);
    const staff = await client.query("INSERT INTO staff(hospital_id,employee_code,first_name) VALUES($1,$2,'Synthetic') RETURNING staff_id::text AS id", [ids.hospitals.a, `SYN-${randomUUID()}`]);
    for (const [table, key, value, assignment] of [
      ["hospitals", "hospital_id", ids.hospitals.a, "hospital_name= hospital_name || ' checked'"],
      ["staff", "staff_id", staff.rows[0].id, "first_name= first_name || ' checked'"],
      ["users", "user_id", user, "username= username || ' checked'"],
      ["patients", "patient_id", ids.patients.a, "first_name= first_name || ' checked'"],
      ["claims", "claim_id", id, "remarks='Synthetic timestamp check'"],
    ]) {
      const prior = await client.query(`SELECT updated_at FROM ${table} WHERE ${key}=$1`, [value]);
      await client.query("SELECT pg_sleep(0.005)");
      const updated = await client.query(`UPDATE ${table} SET ${assignment} WHERE ${key}=$1 RETURNING updated_at`, [value]);
      assert.ok(updated.rows[0].updated_at > prior.rows[0].updated_at, `${table}.updated_at was not maintained`);
    }
  });
});

test("application role cannot delete clinical history or modify global catalogs", async () => {
  await assert.rejects(appPool.query("DELETE FROM claims WHERE claim_no='SYN-MIGRATION-PRESERVATION'"), (error: unknown) => (error as { code?: string }).code === "42501");
  await assert.rejects(appPool.query("UPDATE roles SET role_name='Overwrite' WHERE role_code='FINANCE_OFFICER'"), (error: unknown) => (error as { code?: string }).code === "42501");
});
