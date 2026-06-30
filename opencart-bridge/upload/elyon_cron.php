<?php
/**
 * Elyon CRM — daily safety-net sync (run by cPanel Cron).
 *
 * Live order-sync already happens in real time via the storefront event.
 * This cron is a backstop: it re-sends orders from the last few days (in the
 * configured statuses) to the CRM, so anything a momentary outage missed still
 * lands. Fully idempotent — the CRM de-dupes on the OpenCart order id and only
 * refreshes still-untouched pendings.
 *
 * cPanel Cron command (recommended, runs via CLI — no auth needed):
 *   /usr/local/bin/php -q /home/naturatbg/public_html/upload/elyon_cron.php
 *
 * Or via URL (must include the shared secret as ?token=):
 *   https://naturatherapy.bg/elyon_cron.php?token=<WEBHOOK_SECRET>
 */

error_reporting(E_ERROR | E_PARSE);

$DAYS = 3; // rolling re-check window

// Store config → DB credentials + DIR_SYSTEM (path to the bridge library).
require __DIR__ . '/config.php';

$cli = (PHP_SAPI === 'cli');

// DB connect.
$link = @mysqli_connect(DB_HOSTNAME, DB_USERNAME, DB_PASSWORD, DB_DATABASE, (int)DB_PORT);
if (!$link) { if (!$cli) { http_response_code(500); } die("DB connect failed\n"); }
mysqli_set_charset($link, 'utf8');

// Load the module's saved settings (url, secret, statuses, source).
$settings = array();
$rs = mysqli_query($link, "SELECT `key`, `value`, `serialized` FROM `" . DB_PREFIX . "setting` WHERE store_id = 0 AND `code` = 'module_elyon_bridge'");
if ($rs) {
    while ($row = mysqli_fetch_assoc($rs)) {
        $settings[$row['key']] = $row['serialized'] ? @unserialize($row['value']) : $row['value'];
    }
}
$secret = isset($settings['module_elyon_bridge_secret']) ? $settings['module_elyon_bridge_secret'] : '';

// Web access requires the shared secret; CLI (cron) is always allowed.
if (!$cli) {
    $token = isset($_GET['token']) ? $_GET['token'] : '';
    if (!$secret || !hash_equals((string)$secret, (string)$token)) { http_response_code(403); die("Forbidden\n"); }
    header('Content-Type: application/json');
}

// Reuse the shared bridge library via a tiny OpenCart-registry shim.
require_once DIR_SYSTEM . 'library/elyon/bridge.php';

class ElyonCronConfig { public $d; function __construct($d){ $this->d = $d; } function get($k){ return isset($this->d[$k]) ? $this->d[$k] : null; } }
class ElyonCronDb {
    public $link; function __construct($l){ $this->link = $l; }
    function query($sql){
        $res = mysqli_query($this->link, $sql);
        $o = new stdClass(); $o->rows = array(); $o->num_rows = 0; $o->row = array();
        if ($res instanceof mysqli_result) {
            while ($r = mysqli_fetch_assoc($res)) { $o->rows[] = $r; }
            $o->num_rows = count($o->rows);
            $o->row = $o->num_rows ? $o->rows[0] : array();
            mysqli_free_result($res);
        }
        return $o;
    }
    function escape($v){ return mysqli_real_escape_string($this->link, $v); }
}
class ElyonCronRegistry { private $s = array(); function set($k,$v){ $this->s[$k] = $v; } function get($k){ return isset($this->s[$k]) ? $this->s[$k] : null; } }

$db = new ElyonCronDb($link);
$registry = new ElyonCronRegistry();
$registry->set('config', new ElyonCronConfig($settings));
$registry->set('db', $db);

// Same status filter as the admin import (default: any real order).
$statuses = (isset($settings['module_elyon_bridge_statuses']) && is_array($settings['module_elyon_bridge_statuses']))
    ? array_map('intval', $settings['module_elyon_bridge_statuses']) : array();
$statusSql = count($statuses) ? " AND order_status_id IN (" . implode(',', $statuses) . ")" : " AND order_status_id > 0";

$since = date('Y-m-d 00:00:00', strtotime("-{$DAYS} days"));
$orders = $db->query("SELECT order_id FROM `" . DB_PREFIX . "order` WHERE date_added >= '" . $db->escape($since) . "'" . $statusSql . " ORDER BY order_id ASC");

$sent = 0; $failed = 0;
foreach ($orders->rows as $r) {
    $res = elyon_bridge_send_order($registry, $r['order_id'], 'order');
    if (!empty($res['ok'])) { $sent++; } else { $failed++; }
}

echo json_encode(array('total' => (int)$orders->num_rows, 'sent' => $sent, 'failed' => $failed, 'since' => $since, 'at' => date('c'))) . "\n";
