
DO $$
DECLARE
  r RECORD;
  lead_item RECORD;
  new_product_name TEXT;
  new_total NUMERIC;
  new_qty INT;
BEGIN
  FOR r IN
    SELECT o.id as order_id, o.source_lead_id
    FROM orders o
    WHERE o.source_lead_id IS NOT NULL
      AND o.price = 0
      AND o.status IN ('confirmed', 'shipped', 'delivered', 'paid')
  LOOP
    -- Delete existing bad order_items
    DELETE FROM order_items WHERE order_id = r.order_id;

    -- Copy prediction_lead_items to order_items
    INSERT INTO order_items (order_id, product_id, product_name, quantity, price_per_unit, total_price)
    SELECT r.order_id, pli.product_id, pli.product_name, pli.quantity, pli.price_per_unit, pli.total_price
    FROM prediction_lead_items pli
    WHERE pli.lead_id = r.source_lead_id;

    -- Recalculate order totals from the new items
    SELECT 
      string_agg(oi.product_name || ' x' || oi.quantity, ', '),
      COALESCE(SUM(oi.total_price), 0),
      COALESCE(SUM(oi.quantity), 1)
    INTO new_product_name, new_total, new_qty
    FROM order_items oi
    WHERE oi.order_id = r.order_id;

    -- Update the order with correct summary
    IF new_product_name IS NOT NULL THEN
      UPDATE orders 
      SET price = new_total, 
          product_name = new_product_name, 
          quantity = new_qty
      WHERE id = r.order_id;
    END IF;
  END LOOP;
END $$;
