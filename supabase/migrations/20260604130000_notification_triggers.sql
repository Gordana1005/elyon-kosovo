-- In-app notification triggers for the important events.
--
-- Every trigger function is SECURITY DEFINER + exception-swallowing, so a
-- notification failure can NEVER roll back the underlying business write
-- (missed-call ingestion, an order status change, or a stock decrement). The
-- worst case is "no notification", never a failed write.
--
-- "Superadmin" = the `admin` role (admins are shown as Superadmin in the UI and
-- implicitly hold every role). Admins receive the oversight copy of every event.

-- ════════════════════════════════════════════════════════════════
-- 1) Missed call → prior agent (personal) + every admin (oversight)
-- ════════════════════════════════════════════════════════════════
-- AFTER INSERT only: the webhook upserts with ignoreDuplicates on `uniqueid`,
-- so a PBX retry inserts no row and this trigger does NOT double-fire.
CREATE OR REPLACE FUNCTION public.tg_notify_missed_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prior_agent uuid;
  agent_name  text;
  cust_name   text;
  who         text;
  admin_excl  uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  -- Last agent who called this number (last-8 match), if any.
  IF NEW.linked_phone_norm IS NOT NULL AND length(NEW.linked_phone_norm) > 0 THEN
    SELECT cl.agent_id INTO prior_agent
    FROM public.call_logs cl
    WHERE cl.customer_phone ILIKE '%' || NEW.linked_phone_norm
      AND cl.agent_id IS NOT NULL
    ORDER BY cl.created_at DESC
    LIMIT 1;
  END IF;

  -- Customer display name from a linked order, if we matched one.
  IF NEW.linked_order_id IS NOT NULL THEN
    SELECT o.customer_name INTO cust_name FROM public.orders o WHERE o.id = NEW.linked_order_id;
  END IF;
  who := COALESCE(NULLIF(cust_name, ''), NEW.caller_number);

  -- Personal copy to the prior agent ("call them back").
  IF prior_agent IS NOT NULL THEN
    admin_excl := prior_agent;
    SELECT p.full_name INTO agent_name FROM public.profiles p WHERE p.user_id = prior_agent;
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (prior_agent, 'missed_call', 'Missed call from your client',
            who || CASE WHEN NULLIF(cust_name, '') IS NOT NULL THEN ' (' || NEW.caller_number || ')' ELSE '' END
                || ' just called and missed you — call them back.',
            '/missed-calls');
  END IF;

  -- Oversight copy to every admin (excluding the prior agent to avoid a dup).
  INSERT INTO public.notifications (user_id, type, title, message, link)
  SELECT ur.user_id, 'missed_call', 'Missed call',
         who || CASE WHEN NULLIF(cust_name, '') IS NOT NULL THEN ' (' || NEW.caller_number || ')' ELSE '' END || ' missed' ||
           CASE WHEN prior_agent IS NOT NULL
                THEN ' — last handled by ' || COALESCE(agent_name, 'an agent') || '.'
                ELSE ' — no prior agent.' END,
         '/missed-calls'
  FROM public.user_roles ur
  WHERE ur.role = 'admin' AND ur.user_id <> admin_excl;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- never break the missed-call insert
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_missed_call ON public.missed_calls;
CREATE TRIGGER trg_notify_missed_call
  AFTER INSERT ON public.missed_calls
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_missed_call();

-- ════════════════════════════════════════════════════════════════
-- 2) Order returned → confirming/owning agent + every admin
-- ════════════════════════════════════════════════════════════════
-- Catches every path that flips an order to 'returned' (manual edit, the
-- BigArena CSV sync, bulk status update) in one place.
CREATE OR REPLACE FUNCTION public.tg_notify_order_returned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  label    text;
  msg      text;
BEGIN
  owner_id := COALESCE(NEW.confirmed_by_agent_id, NEW.assigned_agent_id);
  label := 'Order ' || COALESCE(NEW.display_id, left(NEW.id::text, 8));
  msg := label || ' (' || COALESCE(NULLIF(NEW.customer_name, ''), NEW.customer_phone, '') || ') was marked Returned.';

  -- Agent copy (the sale owner).
  IF owner_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (owner_id, 'order_returned', 'Order returned', msg, '/orders');
  END IF;

  -- Admin oversight (exclude owner to avoid a dup).
  INSERT INTO public.notifications (user_id, type, title, message, link)
  SELECT ur.user_id, 'order_returned', 'Order returned', msg, '/orders'
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id <> COALESCE(owner_id, '00000000-0000-0000-0000-000000000000');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_order_returned ON public.orders;
CREATE TRIGGER trg_notify_order_returned
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'returned' AND OLD.status IS DISTINCT FROM 'returned')
  EXECUTE FUNCTION public.tg_notify_order_returned();

-- ════════════════════════════════════════════════════════════════
-- 3) Low / out of stock → every admin + warehouse
-- ════════════════════════════════════════════════════════════════
-- Fires only on the DOWNWARD crossing of the threshold, so it never re-pings
-- while a product is already low. Catches all stock-decrement paths.
CREATE OR REPLACE FUNCTION public.tg_notify_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  msg   text;
  title text;
BEGIN
  IF COALESCE(NEW.stock_quantity, 0) = 0 THEN
    title := 'Out of stock';
    msg := 'Out of stock: ' || COALESCE(NEW.name, 'product');
  ELSE
    title := 'Low stock';
    msg := 'Low stock: ' || COALESCE(NEW.name, 'product') || ' (' || NEW.stock_quantity || ' left)';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, link)
  SELECT ur.user_id, 'low_stock', title, msg, '/products'
  FROM public.user_roles ur
  WHERE ur.role IN ('admin', 'warehouse');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;
CREATE TRIGGER trg_notify_low_stock
  AFTER UPDATE OF stock_quantity ON public.products
  FOR EACH ROW
  WHEN (
    COALESCE(NEW.stock_quantity, 0) <= COALESCE(NEW.low_stock_threshold, 5)
    AND COALESCE(OLD.stock_quantity, 0) > COALESCE(OLD.low_stock_threshold, 5)
  )
  EXECUTE FUNCTION public.tg_notify_low_stock();
