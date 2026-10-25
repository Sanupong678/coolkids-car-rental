// Draws the PNG icons used in the e-mails into frontend/public/media/mail/ (e-mail
// apps drop SVG, so the icons go out as images from coolkidscar.com). Same
// stroke icons as the website (frontend/src/components/ui/Icon.vue), drawn by
// headless Chrome with a transparent background, at 2× for sharp phone screens.
//   node src/scripts/mail-icons.js        (needs Chrome / Chromium; CHROME_PATH or auto-detect)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromePath } from "../modules/contracts/pdf.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../frontend/public/media/mail");
mkdirSync(out, { recursive: true });

// the website's icon paths, read straight from Icon.vue
const vue = readFileSync(resolve(here, "../../../frontend/src/components/ui/Icon.vue"), "utf8");
const ICONS = Object.fromEntries([...vue.matchAll(/^\s+'?([a-z0-9-]+)'?: '(<.+>)',$/gm)].map((m) => [m[1], m[2]]));
ICONS.file = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>';
ICONS.key = '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2.5 2.5"/>';
ICONS.clipboard = '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>';
ICONS.id = '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6.5 16a3 3 0 0 1 5 0M14 10h4M14 14h3"/>';
ICONS.globe = '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>';
ICONS.note = '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>';
ICONS.money = '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>';
ICONS.chat = '<path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12z"/>';

// status badges: a filled circle with a white icon
const BADGES = {
  "ok": ["check", "#16a34a"],
  "no": ["x", "#dc2626"],
  "wait": ["clock", "#f59e0b"],
  "doc": ["file", "#2563eb"],
  "slip": ["receipt", "#f59e0b"],
  "prep": ["wrench", "#2563eb"],
  "ready": ["key", "#16a34a"],
  "drive": ["car", "#2563eb"],
  "cancel": ["x", "#6b7280"],
  "staff": ["clipboard", "#e5362c"],
};
// row icons: dark grey strokes on nothing
const ROWS = ["calendar", "flag", "pin", "map", "car", "user", "phone", "mail", "id", "globe", "note", "money", "shield", "receipt", "clock", "chat", "file", "users"];

const chrome = chromePath();
if (!chrome) throw new Error("Chrome / Chromium not found (set CHROME_PATH)");
const work = join(tmpdir(), `coolkids-mail-icons-${process.pid}`);
mkdirSync(work, { recursive: true });

function shoot(name, px, svgInner, { bg = null, color = "#fff", pad = 0.24, stroke = 2.2 } = {}) {
  const icon = Math.round(px * (1 - pad * 2));
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}
    .c{width:${px}px;height:${px}px;border-radius:50%;display:flex;align-items:center;justify-content:center;${bg ? `background:${bg}` : ""}}</style></head>
    <body><div class="c"><svg width="${icon}" height="${icon}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg></div></body></html>`;
  const page = join(work, `${name}.html`);
  writeFileSync(page, html);
  execFileSync(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
    `--window-size=${px},${px}`, `--screenshot=${join(out, `${name}.png`)}`, pathToFileURL(page).href,
  ], { stdio: "ignore" });
}

for (const [name, [icon, bg]] of Object.entries(BADGES)) shoot(`badge-${name}`, 112, ICONS[icon], { bg, stroke: 2.6, pad: 0.26 });
for (const icon of ROWS) shoot(`row-${icon}`, 40, ICONS[icon], { color: "#555b66", pad: 0.1, stroke: 1.8 });
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${Object.keys(BADGES).length + ROWS.length} icons to ${out}`);
