import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: url ?? "postgres://placeholder/db",
  },
  verbose: true,
  strict: true,
});
