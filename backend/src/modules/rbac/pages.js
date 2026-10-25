import { PERMISSIONS as P } from "./permissions.js";

// Back-office pages a sub-admin can be given. Ticking a page grants the
// permissions its screens and buttons need; the API checks those permissions
// on every call, the page list only decides which menu items show.
// Keep the keys in sync with the tabs in frontend/src/views/AdminView.vue.
export const ADMIN_PAGES = {
  dashboard: { label: "ภาพรวม", permissions: [P.ANALYTICS_READ, P.ANALYTICS_FINANCE, P.BOOKINGS_READ, P.DELIVERIES_READ] },
  schedule: { label: "ปฏิทินจอง", permissions: [P.BOOKINGS_READ] },
  operations: {
    label: "งานส่งรถ",
    permissions: [
      P.BOOKINGS_READ, P.BOOKINGS_WRITE, P.BOOKINGS_CANCEL, P.DELIVERIES_READ, P.DELIVERIES_UPDATE, P.DELIVERIES_ASSIGN,
      P.PAYMENTS_READ, P.PAYMENTS_REFUND, P.CONTRACTS_READ, P.USERS_READ_SENSITIVE,
    ],
  },
  approvals: { label: "ตรวจเอกสาร", permissions: [P.BOOKINGS_READ, P.BOOKINGS_WRITE, P.USERS_READ_SENSITIVE] },
  slips: { label: "ตรวจสลิป", permissions: [P.PAYMENTS_READ, P.BOOKINGS_WRITE] },
  maintenance: { label: "ซ่อมบำรุง", permissions: [P.MAINTENANCE_READ, P.MAINTENANCE_WRITE, P.VEHICLES_READ] },
  fleet: { label: "จัดการรถ", permissions: [P.VEHICLES_READ, P.VEHICLES_WRITE, P.VEHICLES_ARCHIVE, P.VEHICLES_PRICE] },
  data: { label: "ข้อมูล", permissions: [P.ANALYTICS_READ, P.ANALYTICS_FINANCE] },
};
export const PAGE_KEYS = Object.keys(ADMIN_PAGES);

/** Union of the permissions behind a set of pages. */
export const permissionsFor = (pages) => [...new Set(pages.flatMap((p) => ADMIN_PAGES[p]?.permissions ?? []))];

// For accounts on the built-in roles (no page list of their own): a page shows
// when the account holds the first permission of that page's bundle.
export const pagesFromPermissions = (perms) => PAGE_KEYS.filter((k) => perms.has(ADMIN_PAGES[k].permissions[0]));
