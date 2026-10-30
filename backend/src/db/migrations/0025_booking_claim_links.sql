-- "Follow in LINE" links for bookings staff made on a customer's behalf: staff send the
-- link in the LINE chat, the customer opens it inside LINE (signed in with LINE at once)
-- and the booking moves to that account, so its LINE notifications reach them.
-- Only a hash of the one-time code is kept; it expires and is cleared once used.
ALTER TABLE bookings
  ADD COLUMN claim_token_hash  bytea,
  ADD COLUMN claim_expires_at  timestamptz,
  ADD COLUMN claimed_at        timestamptz;

CREATE UNIQUE INDEX bookings_claim_token_idx ON bookings (claim_token_hash) WHERE claim_token_hash IS NOT NULL;
