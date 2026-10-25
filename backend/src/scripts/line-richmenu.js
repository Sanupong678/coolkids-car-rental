// Coolkids LINE rich menu.
//   npm run line:richmenu -- export   → assets-src/line/richmenu.png (2500×1686), from the
//                                        frontend's /line-demo/richmenu page (dev server running)
//   npm run line:richmenu -- upload   → creates the menu on the Official Account (areas + image)
//                                        and makes it the default for every friend
// The areas come from frontend/src/components/line/richMenu.js, the same file the demo uses.
// Uploading needs LINE_MESSAGING_ACCESS_TOKEN and LIFF_ID in .env.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.js";
import { chromePath } from "../modules/contracts/pdf.js";
import { AREAS, SIZE } from "../../../frontend/src/components/line/richMenu.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const IMAGE = resolve(ROOT, "assets-src/line/richmenu.png");
const JPEG = resolve(ROOT, "assets-src/line/richmenu.jpg"); // smaller copy for upload, preferred when present
const MAX_BYTES = 1024 * 1024; // LINE refuses rich menu images over 1 MB

function exportImage() {
  const chrome = chromePath();
  if (!chrome) throw new Error("Chrome / Edge not found: set CHROME_PATH");
  mkdirSync(dirname(IMAGE), { recursive: true });
  const url = `${process.env.DEMO_URL ?? "http://localhost:5173"}/line-demo/richmenu`;
  execFileSync(chrome, [
    "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1", "--virtual-time-budget=6000",
    `--window-size=${SIZE.width},${SIZE.height}`, `--screenshot=${IMAGE}`, url,
  ], { stdio: "ignore" });
  const kb = Math.round(statSync(IMAGE).size / 1024);
  console.log(`✓ ${IMAGE} (${kb} KB)${kb * 1024 > MAX_BYTES ? " — over LINE's 1 MB limit: save it as richmenu.jpg (quality ~90) next to it" : ""}`);
}

async function line(path, { method = "GET", body, contentType = "application/json", host = "api.line.me" } = {}) {
  const res = await fetch(`https://${host}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.LINE_MESSAGING_ACCESS_TOKEN}`, ...(body ? { "Content-Type": contentType } : {}) },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const LABEL = { logo: "Coolkids", documents: "กรอกเอกสาร", contact: "ติดต่อเรา", promotions: "โปรโมชั่น", cars: "เลือกรถ" };

async function upload() {
  if (!config.LINE_MESSAGING_ACCESS_TOKEN || !config.LIFF_ID) throw new Error("Set LINE_MESSAGING_ACCESS_TOKEN and LIFF_ID in .env first");
  const useJpeg = existsSync(JPEG);
  const image = readFileSync(useJpeg ? JPEG : IMAGE);
  if (image.length > MAX_BYTES) throw new Error("rich menu image is over 1 MB");
  const { richMenuId } = await line("/v2/bot/richmenu", {
    method: "POST",
    body: JSON.stringify({
      size: SIZE,
      selected: true, // open by default, like the demo
      name: "Coolkids main menu",
      chatBarText: "เมนู Coolkids",
      areas: AREAS.map((a) => ({
        bounds: a.bounds,
        action: a.action.type === "message"
          ? { type: "message", label: LABEL[a.key], text: a.action.text }
          : { type: "uri", label: LABEL[a.key], uri: `https://liff.line.me/${config.LIFF_ID}${a.action.path === "/" ? "" : a.action.path}` },
      })),
    }),
  });
  await line(`/v2/bot/richmenu/${richMenuId}/content`, { method: "POST", body: image, contentType: useJpeg ? "image/jpeg" : "image/png", host: "api-data.line.me" });
  await line(`/v2/bot/user/all/richmenu/${richMenuId}`, { method: "POST" });
  console.log(`✓ rich menu ${richMenuId} uploaded and set as default`);
}

const cmd = process.argv[2];
if (cmd === "export") exportImage();
else if (cmd === "upload") await upload();
else console.log("usage: npm run line:richmenu -- export | upload");
