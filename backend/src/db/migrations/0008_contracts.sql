-- 0008 — Versioned contract templates and generated contracts.
-- Templates are data, not code: changing the contract = publishing a new
-- template version. Each contract freezes the exact data + template version used.

CREATE TABLE contract_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL CHECK (code ~ '^[a-z0-9_]+$'),   -- e.g. 'standard_rental', 'rental_th'
  version            integer NOT NULL CHECK (version >= 1),
  locale             text NOT NULL DEFAULT 'en',
  country_code       char(2),                                       -- NULL = default for all countries
  title              text NOT NULL,
  engine             text NOT NULL DEFAULT 'handlebars' CHECK (engine IN ('handlebars')),
  body               text NOT NULL,                                 -- HTML template with {{placeholders}}
  -- JSON Schema of the data the template expects; the generator validates against it.
  variables_schema   jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  published_at       timestamptz,
  published_by       uuid REFERENCES users(id),
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version, locale),
  CHECK (status = 'DRAFT' OR published_at IS NOT NULL)
);
-- At most one published version per template/locale/country at a time.
CREATE UNIQUE INDEX contract_templates_one_published ON contract_templates (code, locale, COALESCE(country_code, '--'))
  WHERE status = 'PUBLISHED';

-- Published templates are immutable; only status may move PUBLISHED -> RETIRED.
CREATE OR REPLACE FUNCTION contract_templates_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.variables_schema IS DISTINCT FROM OLD.variables_schema
                                OR NEW.version IS DISTINCT FROM OLD.version) THEN
    RAISE EXCEPTION 'Published contract templates are immutable; create a new version' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_templates_freeze BEFORE UPDATE ON contract_templates FOR EACH ROW EXECUTE FUNCTION contract_templates_freeze();
CREATE TRIGGER contract_templates_no_delete BEFORE DELETE ON contract_templates FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE SEQUENCE contract_number_seq;

CREATE TABLE contracts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number        text NOT NULL UNIQUE
                         DEFAULT ('RC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contract_number_seq')::text, 6, '0')),
  booking_id             uuid NOT NULL REFERENCES bookings(id),
  user_id                uuid NOT NULL REFERENCES users(id),
  template_id            uuid NOT NULL REFERENCES contract_templates(id),
  -- Frozen merge data (customer, vehicle, booking, pricing, payment). Sensitive
  -- document numbers appear masked here; the PDF is in a private bucket.
  data_snapshot          jsonb NOT NULL,
  rendered_html_sha256   bytea NOT NULL,             -- tamper evidence
  document_media_id      uuid REFERENCES media(id),  -- generated PDF
  status                 text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','SIGNED','VOID','SUPERSEDED')),
  signed_at              timestamptz,
  signature_method       text CHECK (signature_method IN ('CLICK_WRAP','DRAWN','ESIGN_PROVIDER')),
  signature_media_id     uuid REFERENCES media(id),
  signer_ip              inet,
  signer_user_agent      text,
  supersedes_contract_id uuid REFERENCES contracts(id),  -- booking modifications produce a new contract
  generated_by           uuid REFERENCES users(id),      -- NULL = system
  created_at             timestamptz NOT NULL DEFAULT now(),
  voided_at              timestamptz,
  voided_by              uuid REFERENCES users(id),
  void_reason            text,
  CHECK ((status = 'SIGNED') = (signed_at IS NOT NULL) OR status IN ('VOID','SUPERSEDED')),
  CHECK ((status = 'VOID') = (voided_at IS NOT NULL))
);
-- Exactly one live contract per booking.
CREATE UNIQUE INDEX contracts_one_live_per_booking ON contracts (booking_id) WHERE status IN ('ISSUED','SIGNED');
CREATE INDEX contracts_user_idx ON contracts (user_id, created_at DESC);
CREATE INDEX contracts_created_idx ON contracts (created_at);
CREATE TRIGGER contracts_no_delete BEFORE DELETE ON contracts FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
