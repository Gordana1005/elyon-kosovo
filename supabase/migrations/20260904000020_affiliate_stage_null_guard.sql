-- Affiliate postback capture — explicit NULL-stage guard.
--
-- public.affiliate_stage() (20260801000200) predates the 'duplicated' enum
-- value added by 20260802000000, so it returns NULL for it. The capture
-- trigger then tried to INSERT event = NULL, violated the NOT NULL / CHECK
-- constraint, and the swallow-all EXCEPTION handler hid the failure.
--
-- The observable behaviour was already correct (no postback fires for a
-- duplicated order — which is exactly what we want: internal copies are our
-- bookkeeping and must stay invisible to the partner). But it was correct by
-- accident, via an exception. Make it intentional so a future stage that
-- genuinely needs reporting can't be silently swallowed the same way.
--
-- Note the ORIGINAL affiliate order is never the one that becomes
-- 'duplicated' — POST /orders/:id/duplicate creates a NEW row with
-- source_type 'manual' and no affiliate_leads sidecar, so neither trigger
-- matches it. This guard covers any other path that might set the status.

CREATE OR REPLACE FUNCTION public.tg_enqueue_affiliate_postback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lead   record;
  _event  text;
  _reason text;
BEGIN
  SELECT id, affiliate_id INTO _lead
  FROM public.affiliate_leads WHERE order_id = NEW.id;
  IF _lead.id IS NULL THEN
    RETURN NEW;  -- not an affiliate lead (or sidecar row not written yet)
  END IF;

  IF TG_OP = 'INSERT' THEN
    _event := 'lead';
  ELSE
    IF public.affiliate_stage(NEW.status) IS NOT DISTINCT FROM public.affiliate_stage(OLD.status) THEN
      RETURN NEW;  -- internal churn within the same affiliate-visible stage
    END IF;
    _event := public.affiliate_stage(NEW.status);
    IF _event = 'wait' THEN
      _event := 'lead';  -- regression back to processing re-uses the 'lead' event
    END IF;
  END IF;

  -- Statuses with no affiliate-visible stage ('duplicated', and anything added
  -- to the enum later) are INTENTIONALLY not reported.
  IF _event IS NULL THEN
    RETURN NEW;
  END IF;

  _reason := COALESCE(NEW.cancellation_reason, NEW.return_reason, NEW.trash_reason);

  INSERT INTO public.affiliate_postbacks (affiliate_id, affiliate_lead_id, order_id, event, reason)
  VALUES (_lead.affiliate_id, _lead.id, NEW.id, _event, _reason)
  ON CONFLICT (affiliate_lead_id, event) WHERE status = 'pending' DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
