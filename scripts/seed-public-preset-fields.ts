import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";

async function main() {
  const sqlText = readFileSync(
    join(process.cwd(), "scripts/seed-public-preset-fields.sql"),
    "utf8",
  );
  const db = getDb();
  await db.execute(sql.raw(sqlText));
  const rows = await db.execute(
    sql.raw(
      "SELECT slug, mood, category, display_order, hero_image_url FROM preset WHERE slug IN ('studio_athletic','leather_noir','graffiti_alley','mono_street','shutter_crew') ORDER BY display_order",
    ),
  );
  console.log("seeded rows:", JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
