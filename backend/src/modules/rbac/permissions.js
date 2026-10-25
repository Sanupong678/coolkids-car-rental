// Single source of truth for RBAC. The seed syncs these into roles /
// permissions / role_permissions; middleware checks against the same codes.
// Adding a permission = add it here + grant it below + run `npm run db:seed`.

export const PERMISSIONS = {
  USERS_READ: "users:read",
  USERS_READ_SENSITIVE: "users:read_sensitive", // identity documents, DOB, address
  USERS_WRITE: "users:write",
  ROLES_MANAGE: "roles:manage",
  STAFF_READ: "staff:read",
  STAFF_WRITE: "staff:write",

  VEHICLES_READ: "vehicles:read", // admin view incl. drafts/archived, costs
  VEHICLES_WRITE: "vehicles:write",
  VEHICLES_ARCHIVE: "vehicles:archive",
  VEHICLES_PRICE: "vehicles:price",
  CATEGORIES_WRITE: "categories:write",
  LOCATIONS_WRITE: "locations:write",

  BOOKINGS_READ: "bookings:read",
  BOOKINGS_WRITE: "bookings:write",
  BOOKINGS_CANCEL: "bookings:cancel",
  PAYMENTS_READ: "payments:read",
  PAYMENTS_REFUND: "payments:refund",
  CONTRACTS_READ: "contracts:read",
  CONTRACTS_WRITE: "contracts:write", // templates, regenerate, void

  PROMOTIONS_READ: "promotions:read",
  PROMOTIONS_WRITE: "promotions:write",
  CMS_WRITE: "cms:write",

  DELIVERIES_READ: "deliveries:read",
  DELIVERIES_ASSIGN: "deliveries:assign",
  DELIVERIES_UPDATE: "deliveries:update", // drivers update their own assignments
  MAINTENANCE_READ: "maintenance:read",
  MAINTENANCE_WRITE: "maintenance:write",

  ANALYTICS_READ: "analytics:read",
  ANALYTICS_FINANCE: "analytics:finance", // revenue, payments, ROI
  AUDIT_READ: "audit:read",
  SETTINGS_WRITE: "settings:write", // tax, deposits, booking policy
};

const P = PERMISSIONS;
const ALL = Object.values(P);

export const ROLES = {
  super_admin: { name: "Super Admin", description: "Full access including roles and system settings", permissions: ALL },
  admin: {
    name: "Admin",
    description: "Runs the business: content, fleet, bookings, analytics",
    permissions: ALL.filter((p) => p !== P.ROLES_MANAGE && p !== P.SETTINGS_WRITE),
  },
  fleet_manager: {
    name: "Fleet Manager",
    description: "Vehicles, pricing, categories, maintenance",
    permissions: [
      P.VEHICLES_READ, P.VEHICLES_WRITE, P.VEHICLES_ARCHIVE, P.VEHICLES_PRICE, P.CATEGORIES_WRITE, P.LOCATIONS_WRITE,
      P.MAINTENANCE_READ, P.MAINTENANCE_WRITE, P.BOOKINGS_READ, P.DELIVERIES_READ, P.STAFF_READ, P.ANALYTICS_READ,
      P.PROMOTIONS_READ,
    ],
  },
  operations: {
    name: "Operations Staff",
    description: "Bookings, customers, contracts, dispatch",
    permissions: [
      P.BOOKINGS_READ, P.BOOKINGS_WRITE, P.BOOKINGS_CANCEL, P.USERS_READ, P.USERS_READ_SENSITIVE, P.CONTRACTS_READ,
      P.CONTRACTS_WRITE, P.DELIVERIES_READ, P.DELIVERIES_ASSIGN, P.VEHICLES_READ, P.PAYMENTS_READ, P.MAINTENANCE_READ,
      P.STAFF_READ, P.PROMOTIONS_READ,
    ],
  },
  finance: {
    name: "Finance Staff",
    description: "Payments, refunds, invoices, revenue",
    permissions: [
      P.PAYMENTS_READ, P.PAYMENTS_REFUND, P.BOOKINGS_READ, P.CONTRACTS_READ, P.USERS_READ, P.ANALYTICS_READ,
      P.ANALYTICS_FINANCE, P.PROMOTIONS_READ, P.VEHICLES_READ,
    ],
  },
  delivery: {
    name: "Delivery Staff",
    description: "Own delivery/collection assignments",
    permissions: [P.DELIVERIES_READ, P.DELIVERIES_UPDATE, P.BOOKINGS_READ, P.VEHICLES_READ],
  },
  maintenance: {
    name: "Maintenance Staff",
    description: "Service records, inspections, mileage",
    permissions: [P.MAINTENANCE_READ, P.MAINTENANCE_WRITE, P.VEHICLES_READ],
  },
};

export const STAFF_ROLE_CODES = Object.keys(ROLES);
