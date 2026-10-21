import { createReportAction, updateReportAction } from "@/app/report-actions";
import type { Report } from "@/lib/reports";
import { WEATHER_LABELS, WEATHER_ORDER } from "@/lib/weather";

/** Nightly report form, for a new report or correcting an existing one. */
export function ReportForm({ report, locations, today, defaultLocation }: {
  report?: Report; locations: { id: string; name: string }[]; today: string; defaultLocation?: string | null;
}) {
  const v = report;
  const area = (name: keyof Report, label: string, hint: string) => (
    <div>
      <label htmlFor={name}>{label}</label>
      <textarea id={name} name={name} maxLength={4000} defaultValue={(v?.[name] as string) ?? ""} placeholder={hint} />
    </div>
  );
  return (
    <form action={v ? updateReportAction : createReportAction} className="card report-form">
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      <div className="grid3">
        <div>
          <label htmlFor="location_id">Store</label>
          <select id="location_id" name="location_id" required defaultValue={v?.location_id ?? defaultLocation ?? ""}>
            <option value="" disabled>Pick a location</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="report_date">Date</label>
          <input id="report_date" name="report_date" type="date" required max={today} defaultValue={v?.report_date ?? today} />
        </div>
        <div>
          <label htmlFor="manager_on_duty">Manager on duty</label>
          <input id="manager_on_duty" name="manager_on_duty" type="text" required maxLength={100} defaultValue={v?.manager_on_duty ?? ""} />
        </div>
        <div>
          <label htmlFor="sales">Sales ($)</label>
          <input id="sales" name="sales" type="text" inputMode="decimal" required pattern="\$?[0-9,]+(\.[0-9]{1,2})?" defaultValue={v ? v.sales.toFixed(2) : ""} placeholder="0.00" />
        </div>
        <div>
          <label htmlFor="weather">Weather</label>
          <select id="weather" name="weather" required defaultValue={v?.weather ?? ""}>
            <option value="" disabled>Pick one</option>
            {WEATHER_ORDER.map((w) => <option key={w} value={w}>{WEATHER_LABELS[w]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="temperature_f">Temperature (°F)</label>
          <input id="temperature_f" name="temperature_f" type="number" required min={-40} max={130} step={1} defaultValue={v?.temperature_f ?? ""} />
        </div>
        <div>
          <label htmlFor="longest_ticket_minutes">Longest ticket time (minutes)</label>
          <input id="longest_ticket_minutes" name="longest_ticket_minutes" type="number" min={0} max={600} step={0.5} defaultValue={v?.longest_ticket_minutes ?? ""} />
        </div>
      </div>
      <div className="grid2">
        {area("general_notes", "General notes", "How the night went")}
        {area("customer_feedback", "Customer feedback", "Compliments, complaints")}
        {area("staffing_issues", "Staffing issues", "Call-outs, short staffed, late arrivals")}
        {area("waste_log", "Waste log notes", "What was thrown out and why")}
        {area("upcoming_events", "Upcoming events", "Catering orders, holidays, local events")}
      </div>
      <p><button type="submit">{v ? "Save changes" : "Submit report"}</button></p>
    </form>
  );
}
