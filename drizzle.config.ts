import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;

// `generate` only diffs the schema files against the stored snapshots, so it has
// to work in environments without a database (e.g. CI builds). Commands that do
// open a connection still fail fast when DATABASE_URL is missing.
const command = process.argv[2];
const needsConnection = command !== undefined && command !== "generate";

if (!connectionString && needsConnection) {
  throw new Error(`DATABASE_URL is required to run "drizzle-kit ${command}"`);
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString ?? "mysql://localhost:3306/unused",
  },
});
