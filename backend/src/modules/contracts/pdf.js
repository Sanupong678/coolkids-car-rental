import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";
import { escapeHtml } from "./render.js";

// Contract → A4 PDF with headless Chrome/Edge ("--print-to-pdf"), so Thai text is
// shaped exactly like in the browser. No npm browser package: the server only
// needs Chrome installed (CHROME_PATH, or auto-detected). The page's CSP forbids
// any script; the HTML itself comes from our escaped template renderer.

const CSS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "contract-pdf.css");
const CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function chromePath() {
  if (config.CHROME_PATH) return config.CHROME_PATH;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

const run = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 45_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });

/** Wraps rendered contract HTML in a printable page (relative image URLs resolve against the site). */
export function contractPage(bodyHtml, css) {
  const base = escapeHtml(`${config.FRONTEND_URL.replace(/\/$/, "")}/`);
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">
<base href="${base}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Inter:wght@400;600;700&family=Unbounded:wght@700&display=block">
<style>${css}</style></head><body>
<img class="wm" src="brand/logo-dark.webp" alt="">
<div class="contract">${bodyHtml}</div>
</body></html>`;
}

export async function renderPdf(bodyHtml) {
  return renderHtmlPdf(contractPage(bodyHtml, await readFile(CSS_FILE, "utf8")));
}

/** Any complete, script-free HTML page (booking slip, receipt …) → A4 PDF. */
export async function renderHtmlPdf(page) {
  const chrome = chromePath();
  if (!chrome) throw new AppError(503, "PDF_UNAVAILABLE", "PDF rendering is not available on this server (install Chrome or set CHROME_PATH)");
  const id = randomUUID();
  const html = path.join(os.tmpdir(), `ck-contract-${id}.html`);
  const pdf = path.join(os.tmpdir(), `ck-contract-${id}.pdf`);
  const profile = path.join(os.tmpdir(), `ck-chrome-${id}`);
  try {
    await writeFile(html, page);
    await run(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      `--user-data-dir=${profile}`,
      "--no-pdf-header-footer",
      "--virtual-time-budget=10000",
      `--print-to-pdf=${pdf}`,
      pathToFileURL(html).href,
    ]);
    return await readFile(pdf);
  } catch (err) {
    logger.error({ err: { message: err.message } }, "contract pdf render failed");
    throw new AppError(500, "PDF_FAILED", "Could not render the contract PDF, please try again");
  } finally {
    await Promise.all([rm(html, { force: true }), rm(pdf, { force: true }), rm(profile, { recursive: true, force: true })]);
  }
}
