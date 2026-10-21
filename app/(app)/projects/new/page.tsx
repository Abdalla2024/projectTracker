import { redirect } from "next/navigation";

// New projects are created in a pop-up on the projects page; keep old links working.
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  redirect(`/?new=1${error ? `&error=${encodeURIComponent(error)}` : ""}`);
}
