-- Notify on order PAID (the positive event): the confirming/owning agent gets a
-- "your order was paid" ping; every superadmin (admin) gets the oversight copy.
-- Same defensive pattern as the returned trigger (SECURITY DEFINER + swallow), so
-- a notification failure can never roll back the status change.
--
-- NOTE: `paid` is higher-volume than returns, and the BigArena CSV import marks
-- many orders paid at once — each becomes one notification per recipient. That is
-- intentional ("superadmins get all"); switch to a bulk summary later if noisy.
CREATE OR REPLACE FUNCTION public.tg_notify_order_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  label    text;
  amount   text;
  msg      text;
BEGIN
  owner_id := COALESCE(NEW.confirmed_by_agent_id, NEW.assigned_agent_id);
  label := 'Order ' || COALESCE(NEW.display_id, left(NEW.id::text, 8));
  amount := '€' || trim(to_char(COALESCE(NEW.price, 0), 'FM999999990.00'));
  msg := label || ' (' || COALESCE(NULLIF(NEW.customer_name, ''), NEW.customer_phone, '') || ') was paid — ' || amount || '.';

  -- Agent copy (the sale owner).
  IF owner_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (owner_id, 'order_paid', 'Order paid', msg, '/orders');
  END IF;

  -- Admin oversight (exclude owner to avoid a dup).
  INSERT INTO public.notifications (user_id, type, title, message, link)
  SELECT ur.user_id, 'order_paid', 'Order paid', msg, '/orders'
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id <> COALESCE(owner_id, '00000000-0000-0000-0000-000000000000');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_order_paid ON public.orders;
CREATE TRIGGER trg_notify_order_paid
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public.tg_notify_order_paid();
