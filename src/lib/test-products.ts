import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";

export interface TestProduct {
  id: string;
  url: string;
  filename: string;
  collection: string;
}

export async function listTestProducts(): Promise<TestProduct[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.testProduct)
    .orderBy(asc(schema.testProduct.collection), asc(schema.testProduct.sortKey));
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    filename: r.filename,
    collection: r.collection,
  }));
}

export async function getTestProduct(
  id: string,
): Promise<TestProduct | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.testProduct)
    .where(eq(schema.testProduct.id, id));
  return rows[0]
    ? {
        id: rows[0].id,
        url: rows[0].url,
        filename: rows[0].filename,
        collection: rows[0].collection,
      }
    : undefined;
}
