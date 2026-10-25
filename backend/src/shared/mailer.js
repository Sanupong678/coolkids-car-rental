import nodemailer from "nodemailer";
import { config } from "../config/env.js";
import { AppError } from "./errors.js";

// Outgoing e-mail over SMTP (the shop's Gmail with an App Password works).
// Not configured → sending is refused with a clear message; nothing is queued.

let transport = null;
const getTransport = () =>
  (transport ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  }));

/** Sends one e-mail; `attachments` as nodemailer expects ({ filename, content, contentType }). */
export async function sendMail({ to, subject, text, html, attachments }) {
  if (!config.mailConfigured) throw new AppError(503, "MAIL_NOT_CONFIGURED", "ยังไม่ได้ตั้งค่าอีเมลของร้าน (SMTP_* ใน .env)");
  await getTransport().sendMail({ from: config.MAIL_FROM || config.SMTP_USER, to, subject, text, html, attachments });
}

/** Test hook: replace the SMTP transport (e.g. nodemailer's jsonTransport). */
export const setMailTransport = (t) => (transport = t);
