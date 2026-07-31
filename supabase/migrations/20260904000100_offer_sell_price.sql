-- Affiliate offers — per-offer customer sell price.
--
-- Affiliate leads must land at the price the partner's landing page actually
-- advertises (€34.90 for the Neuropathy / Snail Complex offer), but intake
-- reads products.price, which is €29.90. That column cannot be changed:
-- Snail Complex has 531 'manual' call-centre orders against 7 affiliate ones,
-- so editing it would reprice the whole call centre.
--
-- price_eur is therefore an OFFER-level override. NULL means "inherit
-- products.price", so every existing offer keeps behaving exactly as before.
--
-- Note this is the CUSTOMER price per package. It is unrelated to payout_eur,
-- which stays a FLAT amount per paid order no matter how many packages the
-- agent upsells (payout_eur_snapshot is frozen at intake and never multiplied
-- by quantity — see the elyon-affiliates skill).

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS price_eur numeric(10,2);

COMMENT ON COLUMN public.offers.price_eur IS
  'Customer price per package for leads on this offer. NULL = inherit products.price. Distinct from payout_eur (flat affiliate commission per PAID order).';
