import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getProjectDetail } from "@/lib/projects";

// Projects open inside the list now. This keeps old links working, and shows the same "not found"
// for a missing project and one the user may not see (the database simply returns no row).
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const project = await getProjectDetail(user.id, id);
  if (!project) notFound();
  redirect(`/?open=${id}#p-${id}`);
}
