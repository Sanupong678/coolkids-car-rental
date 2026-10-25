-- 0007 — Provider-agnostic payments, transactions, refunds, webhook inbox.

-- One payment intent per charge purpose (rental total, deposit hold, damage charge).
CREATE TABLE payments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid NOT NULL REFERENCES bookings(id),
  user_id                uuid NOT NULL REFERENCES users(id),
  purpose                text NOT NULL CHECK (purpose IN ('RENTAL','DEPOSIT','ADDITIONAL_CHARGE')),
  provider               text NOT NULL CHECK (provider ~ '^[a-z0-9_]+$'),   -- 'stripe', 'omise', '2c2p', 'mock' …
  provider_payment_id    text,                                              -- provider's intent/charge id
  amount_minor           bigint NOT NULL CHECK (amount_minor > 0),
  currency               char(3) NOT NULL,
  status                 text NOT NULL DEFAULT 'INITIATED'
                         CHECK (status IN ('INITIATED','REQUIRES_ACTION','AUTHORIZED','SUCCEEDED','FAILED',
                                           'CANCELLED','PARTIALLY_REFUNDED','REFUNDED')),
  amount_refunded_minor  bigint NOT NULL DEFAULT 0 CHECK (amount_refunded_minor >= 0),
  payment_method_type    text,             -- card, promptpay, bank_transfer … (no PAN ever stored)
  payment_method_last4   text,
  failure_code           text,
  failure_message        text,
  idempotency_key        text NOT NULL,
  succeeded_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_refunded_minor <= amount_minor),
  CHECK (status <> 'SUCCEEDED' OR succeeded_at IS NOT NULL),
  UNIQUE (provider, provider_payment_id),
  UNIQUE (provider, idempotency_key)
);
CREATE INDEX payments_booking_idx ON payments (booking_id);
CREATE INDEX payments_user_idx    ON payments (user_id, created_at DESC);
CREATE INDEX payments_status_idx  ON payments (status, created_at);
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_no_delete  BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Append-only ledger of every state change reported by the provider or initiated by us.
CREATE TABLE payment_transactions (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id                 uuid NOT NULL REFERENCES payments(id),
  transaction_type           text NOT NULL CHECK (transaction_type IN ('INITIALIZE','AUTHORIZE','CAPTURE','VOID','FAIL','CANCEL','REFUND')),
  status                     text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
  amount_minor               bigint NOT NULL CHECK (amount_minor >= 0),
  currency                   char(3) NOT NULL,
  provider_transaction_id    text,
  provider_response          jsonb,     -- sanitised: secrets & PAN removed by the adapter
  webhook_event_id           uuid,      -- FK below
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_transactions_payment_idx ON payment_transactions (payment_id, created_at);
CREATE UNIQUE INDEX payment_transactions_provider_tx_uq ON payment_transactions (payment_id, transaction_type, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE TRIGGER payment_transactions_append_only BEFORE UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE refunds (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id             uuid NOT NULL REFERENCES payments(id),
  booking_id             uuid NOT NULL REFERENCES bookings(id),
  amount_minor           bigint NOT NULL CHECK (amount_minor > 0),
  currency               char(3) NOT NULL,
  reason                 text NOT NULL CHECK (reason IN ('CUSTOMER_CANCELLATION','COMPANY_CANCELLATION','DEPOSIT_RETURN',
                                                        'PRICE_ADJUSTMENT','DUPLICATE','OTHER')),
  notes                  text,
  status                 text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
  provider_refund_id     text,
  requested_by           uuid NOT NULL REFERENCES users(id),
  approved_by            uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  UNIQUE (payment_id, provider_refund_id)
);
CREATE INDEX refunds_booking_idx ON refunds (booking_id);

-- Webhook inbox: verified-signature events are stored first, then processed
-- idempotently. UNIQUE(provider, provider_event_id) makes replays harmless.
CREATE TABLE payment_webhook_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider               text NOT NULL,
  provider_event_id      text NOT NULL,
  event_type             text NOT NULL,
  signature_verified     boolean NOT NULL,
  payload                jsonb NOT NULL,
  received_at            timestamptz NOT NULL DEFAULT now(),
  processed_at           timestamptz,
  processing_error       text,
  attempts               integer NOT NULL DEFAULT 0,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX payment_webhook_unprocessed_idx ON payment_webhook_events (received_at) WHERE processed_at IS NULL;

ALTER TABLE payment_transactions
  ADD CONSTRAINT payment_transactions_webhook_fk FOREIGN KEY (webhook_event_id) REFERENCES payment_webhook_events(id);
