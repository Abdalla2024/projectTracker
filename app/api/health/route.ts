import { withoutUser } from "@/lib/db";

export const dynamic = "force-dynamic";

// Deployment check: can this instance reach the database as the restricted app role, and is
// row-level security switched on for projects? Reveals nothing else (no names, versions or URLs).
// withoutUser() also refuses a privileged connection, so a misconfigured DATABASE_URL reports 503.
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const rls = await withoutUser(
      async (c) =>
        (await c.query(
          "select coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.projects')), false) as rls",
        )).rows[0].rls as boolean,
    );
    if (!rls) return Response.json({ ok: false, database: "connected", rowLevelSecurity: false }, { status: 503, headers });
    return Response.json({ ok: true, database: "connected", rowLevelSecurity: true }, { headers });
  } catch (err) {
    console.error("health check failed:", err instanceof Error ? err.message : err);
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
