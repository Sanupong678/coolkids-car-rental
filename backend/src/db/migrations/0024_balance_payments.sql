-- Rent balance + security deposit paid online after confirmation ("ชำระค่าเช่าและเงินประกัน"):
-- one Stripe checkout, recorded as a RENTAL payment plus a DEPOSIT payment linked to it,
-- so the hand-over ledger, receipts and deposit return keep working unchanged.
ALTER TABLE payments
  ADD COLUMN is_balance boolean NOT NULL DEFAULT false,
  ADD COLUMN parent_payment_id uuid REFERENCES payments(id);
CREATE INDEX payments_parent_idx ON payments (parent_payment_id) WHERE parent_payment_id IS NOT NULL;
