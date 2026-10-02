import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAdminUrl, validateConnections } from "../../scripts/db-runtime.mjs";

const connection = (role: string, database: string, host = "127.0.0.1") => `postgresql://${role}:synthetic@${host}:5432/${database}`;
const environment = () => ({
  DATABASE_URL: connection("smiley_app", "sehospitaldb"),
  TEST_DATABASE_URL: connection("smiley_app", "sehospitaldb_test"),
  MIGRATION_DATABASE_URL: connection("smiley_migrator", "sehospitaldb"),
  TEST_MIGRATION_DATABASE_URL: connection("smiley_migrator", "sehospitaldb_test"),
});

test("native runtime accepts separate restricted development and test connections", () => {
  assert.equal(validateConnections(environment()).length, 4);
});

test("native runtime rejects remote hosts, administrator app identities and test crossover", () => {
  for (const replacement of [connection("smiley_app", "sehospitaldb", "example.com"), connection("postgres", "sehospitaldb"), connection("smiley_app", "sehospitaldb_test")]) {
    assert.throws(() => validateConnections({ ...environment(), DATABASE_URL: replacement }));
  }
  assert.throws(() => validateConnections({ ...environment(), TEST_DATABASE_URL: connection("smiley_app", "sehospitaldb") }));
});

test("native runtime rejects missing connections and a split server configuration", () => {
  assert.throws(() => validateConnections({ ...environment(), MIGRATION_DATABASE_URL: "" }));
  assert.throws(() => validateConnections({ ...environment(), TEST_DATABASE_URL: connection("smiley_app", "sehospitaldb_test").replace(":5432/", ":5433/") }));
});

test("native setup administrator is confined to an explicit local postgres database", () => {
  assert.equal(validateAdminUrl("postgresql://postgres:synthetic@localhost:5432/postgres").hostname, "localhost");
  for (const value of [undefined, "postgresql://postgres:synthetic@remote.invalid/postgres", "postgresql://postgres:synthetic@localhost/sehospitaldb", "https://localhost/postgres", "postgresql://postgres@localhost/postgres"]) {
    assert.throws(() => validateAdminUrl(value));
  }
});

test("native runtime rejects driver query overrides that bypass local host or role validation", () => {
  for (const override of ["?host=remote.invalid", "?port=6543", "?user=postgres", "?password=override", "?dbname=unrelated", "#unexpected"]) {
    assert.throws(() => validateConnections({ ...environment(), DATABASE_URL: connection("smiley_app", "sehospitaldb") + override }));
    assert.throws(() => validateAdminUrl("postgresql://postgres:synthetic@localhost:5432/postgres" + override));
  }
});
