-- Create trigger for auto-generating order display IDs
CREATE TRIGGER trigger_generate_order_display_id
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.generate_order_display_id();