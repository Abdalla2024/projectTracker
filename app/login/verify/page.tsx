import { redirect } from "next/navigation";
import { requestCodeAction, verifyCodeAction } from "@/app/actions";
import { Alerts } from "@/app/components/Alerts";
import { getSessionUser } from "@/lib/auth";
import { emailTransport } from "@/lib/config";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { email, error } = await searchParams;
  if (!email) redirect("/login");
  const devConsole = emailTransport() === "console";
  return (
    <main className="login">
      <div className="card">
        <h1>Check your email</h1>
        <p className="muted">We sent a 6-digit code to <b>{email}</b>. It expires in 10 minutes.</p>
        {devConsole ? (
          <p className="alert error">Local development mode: the email is not actually sent. The code is printed in the server terminal.</p>
        ) : null}
        <Alerts error={error} />
        <form action={verifyCodeAction}>
          <input type="hidden" name="email" value={email} />
          <label htmlFor="code">Code</label>
          <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
          <p><button type="submit">Sign in</button></p>
        </form>
        <form action={requestCodeAction}>
          <input type="hidden" name="email" value={email} />
          <button className="link" type="submit">Send a new code</button>
        </form>
      </div>
    </main>
  );
}
