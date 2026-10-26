import { spawn } from "node:child_process";
import { config } from "../config/env.js";
import { AppError } from "./errors.js";

// Background removal for car photos with rembg (github.com/danielgatis/rembg, MIT),
// run on our own server: one short-lived Python process per photo, image in on
// stdin, transparent PNG out on stdout. Nothing stays loaded between photos, so it
// uses no memory while idle; each photo pays a few seconds to load the model.

const unavailable = (message) => new AppError(503, "REMOVE_BG_UNAVAILABLE", message);
const TIMEOUT_MS = 120_000;

// rembg's Python API (the `rembg[cpu]` package; its CLI extra would add a whole web UI).
const CUT = [
  "import sys",
  "from rembg import new_session, remove",
  "sys.stdout.buffer.write(remove(sys.stdin.buffer.read(), session=new_session(sys.argv[1])))",
].join("\n");

function run(args, input) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.REMBG_PYTHON, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      return reject(err);
    }
    const out = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => (err = (err + c).slice(-2000)));
    child.on("error", (e) => (clearTimeout(timer), reject(e)));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(signal ? `stopped (${signal})` : err.trim().split("\n").pop() || `exit ${code}`));
    });
    child.stdin.on("error", () => {}); // the process may exit before reading everything
    child.stdin.end(input);
  });
}

let checked = null;
/** Whether the rembg command can be started here (checked once per server start). */
export function backgroundRemovalAvailable() {
  if (!config.removeBgConfigured) return Promise.resolve(false);
  checked ??= run(["-c", "import rembg"], Buffer.alloc(0)).then(() => true, () => false);
  return checked;
}

// One photo at a time, so several uploads never load the model side by side on a small VPS.
let queue = Promise.resolve();

/** Returns the cut-out as a PNG buffer, or throws a 503 the admin screen can show. */
export async function removeBackground(image) {
  if (!(await backgroundRemovalAvailable())) {
    throw unavailable("Background removal is not installed on this server (rembg)");
  }
  const job = queue.then(() => run(["-c", CUT, config.REMBG_MODEL], image));
  queue = job.catch(() => {});
  let png;
  try {
    png = await job;
  } catch (err) {
    throw unavailable(`Background removal failed: ${err.message}`);
  }
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw unavailable("Background removal returned no image");
  return png;
}
