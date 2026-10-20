import "server-only";
import nodemailer from "nodemailer";
import { emailTransport } from "./config";

export async function sendLoginCode(to: string, code: string): Promise<void> {
  const transport = emailTransport();
  const subject = "Your Ekiben Project Tracker sign-in code";
  const text = `Your sign-in code is ${code}\n\nIt expires in 10 minutes. If you did not request it, you can ignore this email.`;

  if (transport === "console") {
    console.log(`\n[dev email] To: ${to}\n[dev email] Subject: ${subject}\n[dev email] Code: ${code}\n`);
    return;
  }

  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("EMAIL_TRANSPORT=smtp requires SMTP_HOST (and usually SMTP_USER / SMTP_PASSWORD).");
  const mailer = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await mailer.sendMail({ from: process.env.EMAIL_FROM, to, subject, text });
}
