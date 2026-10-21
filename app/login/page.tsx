import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions";
import { Alerts } from "@/app/components/Alerts";
import { Logo } from "@/app/components/Logo";
import { getSessionUser } from "@/lib/auth";
import { allowedDomains } from "@/lib/config";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { error } = await searchParams;
  const domains = allowedDomains();
  return (
    <main className="login">
      <span className="mark"><Logo /></span>
      <div className="card">
        <h1>Sign in</h1>
        <p className="muted">Welcome back. Use your email and password.</p>
        <Alerts error={error} />
        <form action={signInAction}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder={domains[0] ? `you@${domains[0]}` : "you@company.com"} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
          <p><button type="submit">Sign in</button></p>
        </form>
        <p className="hint"><Link href="/signup?mode=reset">Forgot your password?</Link></p>
      </div>
      <p className="hint center">New here? <Link href="/signup">Create an account</Link></p>
      <p className="hint center">Only addresses at {domains.length ? domains.join(", ") : "an allowed Ekiben domain"} can sign in. Demo build: do not enter customer or financial details.</p>
    </main>
  );
}
