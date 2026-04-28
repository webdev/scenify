import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/lib/db/client";
import { generatePresetName } from "../src/lib/preset-naming";

async function main() {
  const force = process.argv.includes("--force");
  const db = getDb();
  const rows = await db.select().from(schema.preset);
  const targets = force
    ? rows
    : rows.filter((r) => !r.description || r.description.trim() === "");
  console.log(
    `Found ${rows.length} presets. ${targets.length} need names${force ? " (forced)" : ""}.`,
  );
  for (const row of targets) {
    try {
      const generated = await generatePresetName({
        currentName: row.name,
        currentDescription: row.description ?? undefined,
      });
      await db
        .update(schema.preset)
        .set({
          name: generated.name,
          description: generated.description,
          updatedAt: new Date(),
        })
        .where(eq(schema.preset.id, row.id));
      console.log(
        `  ${row.slug.padEnd(20)} ${row.name.padEnd(20)} -> ${generated.name.padEnd(20)} | ${generated.description}`,
      );
    } catch (err) {
      console.error(`  ${row.slug}: FAILED`, err);
    }
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
