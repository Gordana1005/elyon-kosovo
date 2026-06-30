<?php
/**
 * Elyon CRM bridge — storefront event handler.
 *
 * Wired by the admin module install() to two core order-model events:
 *   catalog/model/checkout/order/addOrder/after        -> onOrderAdded
 *   catalog/model/checkout/order/addOrderHistory/after  -> onOrderHistory
 *
 * Because OpenCart's event system wraps the CORE order model, these fire for
 * EVERY order regardless of which checkout (incl. the TK one-page checkout)
 * created it.
 */
class ControllerExtensionModuleElyonBridge extends Controller {

    private function lib() {
        require_once(DIR_SYSTEM . 'library/elyon/bridge.php');
    }

    /**
     * Fires for every order row created at checkout — including status 0
     * (incomplete / not-yet-confirmed). We use this purely to capture
     * ABANDONED carts (status still 0) that carry a real name + phone.
     * If/when the order is later confirmed, onOrderHistory upgrades it.
     */
    public function onOrderAdded(&$route, &$args, &$output) {
        if (!$this->config->get('module_elyon_bridge_status')) {
            return;
        }
        if (!$this->config->get('module_elyon_bridge_abandoned')) {
            return; // abandoned capture disabled
        }

        $order_id = (int)$output;
        if (!$order_id) {
            return;
        }

        $this->lib();
        $payload = elyon_bridge_build_payload($this->registry, $order_id, 'abandoned');
        if ($payload === null) {
            return;
        }
        // A real status is already set => it's a confirmed order, leave it to
        // onOrderHistory (avoids double-sending the same order as abandoned).
        if ($payload['status_label'] !== '') {
            return;
        }
        // Only bother the CRM with qualified leads (full name + phone).
        if (!elyon_bridge_qualified_lead($payload)) {
            return;
        }

        elyon_bridge_post($this->registry, $payload);
    }

    /**
     * Fires whenever an order is given / changes status — i.e. a confirmed,
     * real order. Sent to the CRM as a Pending (lands in the Assigner).
     */
    public function onOrderHistory(&$route, &$args, &$output) {
        if (!$this->config->get('module_elyon_bridge_status')) {
            return;
        }

        $order_id = isset($args[0]) ? (int)$args[0] : 0;
        $order_status_id = isset($args[1]) ? (int)$args[1] : 0;
        if (!$order_id || !$order_status_id) {
            return;
        }

        // Only the configured "send" statuses (default Pending). Empty = any.
        $send = $this->config->get('module_elyon_bridge_statuses');
        if (is_array($send) && count($send) && !in_array($order_status_id, $send)) {
            return;
        }

        $this->lib();
        elyon_bridge_send_order($this->registry, $order_id, 'order');
    }
}
