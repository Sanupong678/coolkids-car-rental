-- 0020 — Sub-admin accounts made by the super admin: which back-office pages
--        each one may open. Their permissions come from a role of their own
--        (code staff_xxxxxxxx) holding exactly the permissions of those pages.

CREATE TABLE admin_page_access (
  user_id     uuid NOT NULL REFERENCES users(id),
  page        text NOT NULL CHECK (page IN ('dashboard','schedule','operations','approvals','slips','maintenance','fleet','data')),
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page)
);
