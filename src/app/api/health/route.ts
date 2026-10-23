import { connection } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  await connection(); // always run at request time, never prerendered
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: "up" });
  } catch (err) {
    return Response.json(
      { ok: false, db: "down", error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
