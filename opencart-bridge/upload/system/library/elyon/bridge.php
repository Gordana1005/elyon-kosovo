<?php
/**
 * Elyon CRM bridge — shared order sender.
 *
 * Used by BOTH the storefront event handler (live new orders / abandoned carts)
 * and the admin historical-import action, so the payload-building, HMAC signing
 * and HTTP POST logic live in exactly one place.
 *
 * The CRM verifies: x-webhook-signature = hex(HMAC_SHA256(rawBody, WEBHOOK_SECRET)).
 * We sign the exact JSON string we send, so the bytes always match.
 */

if (!function_exists('elyon_bridge_cfg')) {

    function elyon_bridge_cfg($registry, $key, $default = '') {
        $config = $registry->get('config');
        $v = $config->get('module_elyon_bridge_' . $key);
        return ($v === null || $v === '') ? $default : $v;
    }

    /**
     * Build the CRM payload for one order straight from the DB.
     * Reads the raw tables (not getOrder()) so it works for any order_status_id,
     * including 0 = incomplete/abandoned, where catalog getOrder() returns nothing.
     */
    function elyon_bridge_build_payload($registry, $order_id, $mode) {
        $db = $registry->get('db');
        $order_id = (int)$order_id;

        $q = $db->query("SELECT * FROM `" . DB_PREFIX . "order` WHERE order_id = '" . $order_id . "'");
        if (!$q->num_rows) {
            return null;
        }
        $o = $q->row;

        // Line items
        $items = array();
        $pq = $db->query("SELECT name, model, quantity, price FROM `" . DB_PREFIX . "order_product` WHERE order_id = '" . $order_id . "'");
        foreach ($pq->rows as $r) {
            $items[] = array(
                'name'     => $r['name'],
                'sku'      => $r['model'],
                'quantity' => (int)$r['quantity'],
                'price'    => (float)$r['price'],
            );
        }

        // Human-readable status label (e.g. "Pending"); empty => status 0 (incomplete)
        $status_label = '';
        if (!empty($o['order_status_id'])) {
            $sq = $db->query("SELECT name FROM `" . DB_PREFIX . "order_status` WHERE order_status_id = '" . (int)$o['order_status_id'] . "' AND language_id = '" . (int)$o['language_id'] . "'");
            if ($sq->num_rows) {
                $status_label = $sq->row['name'];
            }
        }

        // Address: prefer payment address, fall back to shipping address
        $address = trim($o['payment_address_1'] . ' ' . $o['payment_address_2']);
        $city = $o['payment_city'];
        $postcode = $o['payment_postcode'];
        if ($address === '' && trim($o['shipping_address_1']) !== '') {
            $address = trim($o['shipping_address_1'] . ' ' . $o['shipping_address_2']);
            $city = $o['shipping_city'];
            $postcode = $o['shipping_postcode'];
        }

        return array(
            'order_id'      => (string)$order_id,
            'mode'          => $mode,
            'status_label'  => $status_label,
            'first_name'    => $o['firstname'],
            'last_name'     => $o['lastname'],
            'customer_name' => trim($o['firstname'] . ' ' . $o['lastname']),
            'phone'         => $o['telephone'],
            'email'         => $o['email'],
            'city'          => $city,
            'address'       => $address,
            'postal_code'   => $postcode,
            'comment'       => $o['comment'],
            'total'         => (float)$o['total'],
            'currency'      => $o['currency_code'],
            'source'        => elyon_bridge_cfg($registry, 'source', 'naturatherapy.bg'),
            'date_added'    => $o['date_added'],
            'items'         => $items,
        );
    }

    /** A qualified abandoned lead needs a first+last name and a real phone. */
    function elyon_bridge_qualified_lead($payload) {
        $name_parts = preg_split('/\s+/', trim($payload['customer_name']));
        $name_parts = array_filter($name_parts);
        $digits = preg_replace('/\D/', '', $payload['phone']);
        return (count($name_parts) >= 2) && (strlen($digits) >= 8);
    }

    /** Sign + POST one payload to the CRM. Returns array(ok, code, resp, error). */
    function elyon_bridge_post($registry, $payload) {
        $url = elyon_bridge_cfg($registry, 'url', '');
        $secret = elyon_bridge_cfg($registry, 'secret', '');
        if ($url === '') {
            return array('ok' => false, 'error' => 'CRM URL not configured');
        }

        $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
        $sig = hash_hmac('sha256', $json, $secret);

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 8);
        curl_setopt($ch, CURLOPT_TIMEOUT, 20);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array(
            'Content-Type: application/json',
            'X-Webhook-Signature: ' . $sig,
        ));
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        return array(
            'ok'    => ($code >= 200 && $code < 300),
            'code'  => $code,
            'resp'  => $resp,
            'error' => $err,
        );
    }

    /** Build + send one order by id. */
    function elyon_bridge_send_order($registry, $order_id, $mode) {
        $payload = elyon_bridge_build_payload($registry, $order_id, $mode);
        if ($payload === null) {
            return array('ok' => false, 'error' => 'order not found');
        }
        return elyon_bridge_post($registry, $payload);
    }
}
