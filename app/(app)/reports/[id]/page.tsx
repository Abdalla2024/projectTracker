import Link from "next/link";
import { notFound } from "next/navigation";
import { Alerts } from "@/app/components/Alerts";
import { ReportForm } from "@/app/components/ReportForm";
import { requireUser } from "@/lib/auth";
import { listOrg } from "@/lib/org";
import { isUuid } from "@/lib/projects";
import { getReport } from "@/lib/reports";
import { formatDate, formatDateTime, localDateString, timeZone } from "@/lib/time";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  // Same "not found" for a missing report and one this person may not see.
  const report = isUuid(id) ? await getReport(user.id, id) : null;
  if (!report) notFound();
  const zone = timeZone();
  const locations = (await listOrg(user.id, "locations")).filter((l) => !l.archived_at || l.id === report.location_id);
  return (
    <>
      <Link className="back" href="/reports">← Nightly reports</Link>
      <div className="page-head">
        <h1>{report.location_name} · {formatDate(report.report_date)}</h1>
        <span className="muted">Submitted by {report.submitter_name}, {formatDateTime(report.created_at, zone)}</span>
      </div>
      <Alerts error={sp.error} saved={sp.saved} />
      <ReportForm report={report} locations={locations} today={localDateString(new Date(), zone)} />
    </>
  );
}
