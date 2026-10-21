import { PRIORITY_LABELS, STATUS_LABELS } from "./constants";
import { formatDate } from "./time";

const label = (field: string | null, v: string | null) => {
  if (v === null || v === "") return "none";
  if (field === "status") return STATUS_LABELS[v] ?? v;
  if (field === "priority") return PRIORITY_LABELS[v] ?? v;
  if (field === "deadline") return formatDate(v);
  if (field === "progress") return `${v}%`;
  return v.length > 80 ? `${v.slice(0, 80)}…` : v;
};

export function describeEvent(e: { event_type: string; field: string | null; old_value: string | null; new_value: string | null }): string {
  switch (e.event_type) {
    case "created": return "created the project";
    case "archived": return "archived the project";
    case "unarchived": return "restored the project from the archive";
    case "commented": return "added a comment";
    case "comment_edited": return "edited a comment";
    case "comment_deleted": return "deleted a comment";
    case "assignee_added": return `assigned ${e.new_value ?? "someone"}`;
    case "assignee_removed": return `unassigned ${e.old_value ?? "someone"}`;
    case "updated": {
      const f = (e.field ?? "field").replace("_", " ");
      if (e.field === "description") return "edited the description";
      return `changed ${f} from "${label(e.field, e.old_value)}" to "${label(e.field, e.new_value)}"`;
    }
    default: return e.event_type;
  }
}
