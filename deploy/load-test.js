// k6 load test for coolkidscar.com (read-only: pages, assets and public API; nothing is booked).
// All traffic comes from one IP, so the API part stays under the per-IP limits
// (nginx 20 req/s, API 300 req/min); the page/asset part is not rate limited.
//   docker run --rm -i grafana/k6 run - < deploy/load-test.js
// Targets (adjust to the shop's real traffic): p95 under 800 ms, under 1 % errors.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE || "https://coolkidscar.com";

export const options = {
  scenarios: {
    pages: { executor: "ramping-vus", exec: "pages", stages: [{ duration: "15s", target: 30 }, { duration: "30s", target: 30 }, { duration: "15s", target: 0 }] },
    api: { executor: "constant-arrival-rate", exec: "api", rate: 4, timeUnit: "1s", duration: "60s", preAllocatedVUs: 10 },
  },
  thresholds: {
    "http_req_duration{scenario:pages}": ["p(95)<800"],
    "http_req_duration{scenario:api}": ["p(95)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

export function pages() {
  const res = http.get(`${BASE}/`);
  check(res, { "page 200": (r) => r.status === 200 });
  const asset = res.body && res.body.match(/\/assets\/[^"]+\.js/);
  if (asset) check(http.get(`${BASE}${asset[0]}`), { "asset 200": (r) => r.status === 200 });
  sleep(1);
}

const API = ["/api/v1/vehicles?pageSize=12", "/api/v1/content/homepage", "/api/v1/content/site", "/health"];
export function api() {
  const path = API[Math.floor(Math.random() * API.length)];
  check(http.get(`${BASE}${path}`), { "api 200": (r) => r.status === 200 });
}
