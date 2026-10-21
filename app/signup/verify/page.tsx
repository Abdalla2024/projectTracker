import Link from "next/link";
import { redirect } from "next/navigation";
import { completeSignupAction, requestCodeAction } from "@/app/actions";
import { Alerts } from "@/app/components/Alerts";
import { Logo } from "@/app/components/Logo";
import { getSessionUser } from "@/lib/auth";
import { emailTransport } from "@/lib/config";
import { PASSWORD_MIN } from "@/lib/password";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string; mode?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { email, error, mode } = await searchParams;
  if (!email) redirect("/signup");
  const reset = mode === "reset";
  const devConsole = emailTransport() === "console";
  return (
    <main className="login">
      <span className="mark"><Logo size={84} /></span>
      <div className="card">
        <h1>{reset ? "Choose a new password" : "Finish creating your account"}</h1>
        <p className="muted">We sent a 6-digit code to <b>{email}</b>. It expires in 10 minutes.</p>
        {devConsole ? (
          <p className="alert info">Local development mode: the email is not actually sent. The code is printed in the server terminal.</p>
        ) : null}
        <Alerts error={error} />
        <form action={completeSignupAction}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="mode" value={reset ? "reset" : "signup"} />
          <label htmlFor="code">Code from your email</label>
          <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
          <label htmlFor="password">{reset ? "New password" : "Password"}</label>
          <input id="password" name="password" type="password" required minLength={PASSWORD_MIN} maxLength={128} autoComplete="new-password" />
          <p className="hint">At least {PASSWORD_MIN} characters.</p>
          <label htmlFor="confirm">Confirm password</label>
          <input id="confirm" name="confirm" type="password" required minLength={PASSWORD_MIN} maxLength={128} autoComplete="new-password" />
          <p><button type="submit">{reset ? "Save password and sign in" : "Create account"}</button></p>
        </form>
        <form action={requestCodeAction}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="mode" value={reset ? "reset" : "signup"} />
          <button className="link" type="submit">Send a new code</button>
        </form>
      </div>
      <p className="hint center"><Link href="/login">Back to sign in</Link></p>
    </main>
  );
}
