import { redirect } from "next/navigation";
import { requestCodeAction } from "@/app/actions";
import { Alerts } from "@/app/components/Alerts";
import { getSessionUser } from "@/lib/auth";
import { allowedDomains } from "@/lib/config";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { error } = await searchParams;
  const domains = allowedDomains();
  return (
    <main className="login">
      <div className="card">
        <h1>Ekiben Project Tracker</h1>
        <p className="muted">Sign in with your Ekiben email address. We&apos;ll email you a 6-digit code.</p>
        <Alerts error={error} />
        <form action={requestCodeAction}>
          <label htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder={domains[0] ? `you@${domains[0]}` : "you@company.com"} />
          <p><button type="submit">Email me a code</button></p>
        </form>
        <p className="hint">Only addresses at {domains.length ? domains.join(", ") : "an allowed Ekiben domain"} can sign in. Demo build: do not enter customer or financial details.</p>
      </div>
    </main>
  );
}
