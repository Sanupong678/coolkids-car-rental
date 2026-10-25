-- 0014 — PromptPay transfers checked by slip, LINE push notifications,
--        and "car is near / has arrived" alerts from the driver's live position.

-- One row per slip a customer uploads. A slip is only ever VERIFIED once:
-- the bank's transaction reference and the image hash are unique among
-- slips that were not rejected, so the same transfer cannot pay twice.
CREATE TABLE payment_slips (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL REFERENCES payments(id),
  booking_id         uuid NOT NULL REFERENCES bookings(id),
  uploaded_by        uuid NOT NULL REFERENCES users(id),
  media_id           uuid NOT NULL REFERENCES media(id),
  image_sha256       bytea NOT NULL,
  status             text NOT NULL CHECK (status IN ('VERIFIED','NEEDS_REVIEW','REJECTED')),
  trans_ref          text,                  -- bank transaction reference read from the slip QR
  amount_minor       bigint CHECK (amount_minor >= 0),
  transferred_at     timestamptz,
  sender_name        text,
  sender_bank        text,
  receiver_name      text,
  receiver_account   text,                  -- as printed on the slip (masked by the bank)
  reject_code        text,
  reject_reason      text,
  provider           text NOT NULL,         -- 'slipok' | 'manual'
  provider_response  jsonb,
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'VERIFIED' OR amount_minor IS NOT NULL)
);
CREATE INDEX payment_slips_booking_idx ON payment_slips (booking_id, created_at DESC);
CREATE INDEX payment_slips_review_idx ON payment_slips (created_at) WHERE status = 'NEEDS_REVIEW';
CREATE UNIQUE INDEX payment_slips_trans_ref_uq ON payment_slips (trans_ref) WHERE trans_ref IS NOT NULL AND status <> 'REJECTED';
CREATE UNIQUE INDEX payment_slips_image_uq ON payment_slips (image_sha256) WHERE status <> 'REJECTED';
CREATE TRIGGER payment_slips_no_delete BEFORE DELETE ON payment_slips FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Customer notifications can also go out as LINE messages (Messaging API push).
ALTER TABLE notifications DROP CONSTRAINT notifications_channel_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_channel_check CHECK (channel IN ('IN_APP','EMAIL','SMS','PUSH','LINE'));
ALTER TABLE notifications ADD COLUMN failure_reason text;

-- Each delivery alerts the customer once when the car is near and once when it arrives.
ALTER TABLE bookings
  ADD COLUMN delivery_near_notified_at     timestamptz,
  ADD COLUMN delivery_arrived_notified_at  timestamptz;
