import Link from "next/link";
import { Alerts } from "@/app/components/Alerts";
import { ReportForm } from "@/app/components/ReportForm";
import { requireUser } from "@/lib/auth";
import { listOrg } from "@/lib/org";
import { localDateString, timeZone } from "@/lib/time";

export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ error?: string; location?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const locations = (await listOrg(user.id, "locations")).filter((l) => !l.archived_at);
  return (
    <>
      <Link className="back" href="/reports">← Nightly reports</Link>
      <div className="page-head"><h1>New nightly report</h1></div>
      <Alerts error={sp.error} />
      {locations.length === 0 ? (
        <div className="empty-card">No locations yet. An admin adds them in Settings.</div>
      ) : (
        <ReportForm locations={locations} today={localDateString(new Date(), timeZone())} defaultLocation={sp.location} />
      )}
    </>
  );
}
