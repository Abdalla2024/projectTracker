import Link from "next/link";
import { redirect } from "next/navigation";
import { requestCodeAction } from "@/app/actions";
import { Alerts } from "@/app/components/Alerts";
import { Logo } from "@/app/components/Logo";
import { getSessionUser } from "@/lib/auth";
import { allowedDomains } from "@/lib/config";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { error, mode } = await searchParams;
  const reset = mode === "reset";
  const domains = allowedDomains();
  return (
    <main className="login">
      <span className="mark"><Logo size={132} /></span>
      <div className="card">
        <h1>{reset ? "Reset your password" : "Create your account"}</h1>
        <p className="muted">We&apos;ll email you a 6-digit code, then you choose a password.</p>
        <Alerts error={error} />
        <form action={requestCodeAction}>
          <input type="hidden" name="mode" value={reset ? "reset" : "signup"} />
          <label htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder={domains[0] ? `you@${domains[0]}` : "you@company.com"} />
          <p><button type="submit">Email me a code</button></p>
        </form>
      </div>
      <p className="hint center">Already have an account? <Link href="/login">Sign in</Link></p>
    </main>
  );
}
