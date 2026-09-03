import { loadEnv } from "../lib/env";
import { getDbPool } from "../lib/postgres";

async function main() {
  loadEnv();
  console.log("Checking Supabase / PostgreSQL database connection...");

  const pool = getDbPool();
  if (!pool) {
    console.error("❌ No DATABASE_URL found in environment variables.");
    process.exit(1);
  }

  try {
    const client = await pool.connect();
    console.log("✅ Successfully connected to database pool.");

    const nowRes = await client.query("SELECT NOW() as current_time, current_database() as db_name;");
    console.log(`🕒 Server Time: ${nowRes.rows[0].current_time}`);
    console.log(`📁 Database Name: ${nowRes.rows[0].db_name}`);

    // Check table existence and row counts
    const tables = [
      "alerts",
      "verifications",
      "model_verdicts",
      "decisions",
      "positions",
      "attestations",
      "vault_ledger",
      "idempotency_keys",
    ];

    console.log("\nTable Verification:");
    for (const table of tables) {
      try {
        const countRes = await client.query(`SELECT count(*)::int as count FROM ${table}`);
        console.log(`  ✓ Table '${table}': ${countRes.rows[0].count} rows`);
      } catch (e) {
        console.log(`  ✗ Table '${table}' could not be queried:`, (e as Error).message);
      }
    }

    client.release();
    console.log("\n🎉 Database check completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to connect to database:", err);
    process.exit(1);
  }
}

main();
