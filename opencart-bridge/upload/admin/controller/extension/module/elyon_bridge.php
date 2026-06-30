<?php
/**
 * Elyon CRM bridge — admin module.
 *
 *  - Settings page (CRM URL, shared secret, source label, which statuses to send,
 *    abandoned-cart capture toggle).
 *  - install()/uninstall() register/remove the storefront order events.
 *  - import()  one-time historical backfill (AJAX): push existing orders from a
 *    given date onwards into the CRM (default: 1st of the current month).
 *  - test()    connectivity + signature check (AJAX) — creates no data.
 */
class ControllerExtensionModuleElyonBridge extends Controller {
    private $error = array();

    public function index() {
        $this->load->language('extension/module/elyon_bridge');
        $this->document->setTitle($this->language->get('heading_title'));
        $this->load->model('setting/setting');

        if (($this->request->server['REQUEST_METHOD'] == 'POST') && $this->validate()) {
            $this->model_setting_setting->editSetting('module_elyon_bridge', $this->request->post);
            $this->session->data['success'] = $this->language->get('text_success');
            $this->response->redirect($this->url->link('extension/module/elyon_bridge', 'user_token=' . $this->session->data['user_token'], true));
        }

        $data = array();

        foreach (array('warning', 'url', 'secret') as $k) {
            $data['error_' . $k] = isset($this->error[$k]) ? $this->error[$k] : '';
        }

        $data['breadcrumbs'] = array();
        $data['breadcrumbs'][] = array(
            'text' => $this->language->get('text_home'),
            'href' => $this->url->link('common/dashboard', 'user_token=' . $this->session->data['user_token'], true),
        );
        $data['breadcrumbs'][] = array(
            'text' => $this->language->get('text_extension'),
            'href' => $this->url->link('marketplace/extension', 'user_token=' . $this->session->data['user_token'] . '&type=module', true),
        );
        $data['breadcrumbs'][] = array(
            'text' => $this->language->get('heading_title'),
            'href' => $this->url->link('extension/module/elyon_bridge', 'user_token=' . $this->session->data['user_token'], true),
        );

        $data['action'] = $this->url->link('extension/module/elyon_bridge', 'user_token=' . $this->session->data['user_token'], true);
        $data['cancel'] = $this->url->link('marketplace/extension', 'user_token=' . $this->session->data['user_token'] . '&type=module', true);
        $data['import_action'] = $this->url->link('extension/module/elyon_bridge/import', 'user_token=' . $this->session->data['user_token'], true);
        $data['test_action'] = $this->url->link('extension/module/elyon_bridge/test', 'user_token=' . $this->session->data['user_token'], true);
        $data['user_token'] = $this->session->data['user_token'];

        // ── Field values: posted ?? saved ?? default ──
        $cfg = function ($key, $default = '') {
            if (isset($this->request->post['module_elyon_bridge_' . $key])) {
                return $this->request->post['module_elyon_bridge_' . $key];
            }
            $v = $this->config->get('module_elyon_bridge_' . $key);
            return ($v === null) ? $default : $v;
        };

        $data['module_elyon_bridge_status']    = $cfg('status', 0);
        $data['module_elyon_bridge_url']       = $cfg('url', '');
        $data['module_elyon_bridge_secret']    = $cfg('secret', '');
        $data['module_elyon_bridge_source']    = $cfg('source', 'naturatherapy.bg');
        $data['module_elyon_bridge_abandoned'] = $cfg('abandoned', 0);
        $data['module_elyon_bridge_statuses']  = $cfg('statuses', array());
        if (!is_array($data['module_elyon_bridge_statuses'])) {
            $data['module_elyon_bridge_statuses'] = array();
        }

        // Order statuses for the multiselect. Default-select "Pending" if nothing saved.
        $this->load->model('localisation/order_status');
        $data['order_statuses'] = $this->model_localisation_order_status->getOrderStatuses();
        if (empty($data['module_elyon_bridge_statuses'])) {
            foreach ($data['order_statuses'] as $os) {
                if (mb_strtolower($os['name']) === 'pending' || mb_strtolower($os['name']) === 'обработва се' || (int)$os['order_status_id'] === 1) {
                    $data['module_elyon_bridge_statuses'][] = (int)$os['order_status_id'];
                }
            }
        }

        // Default import date = 1st of the current month.
        $data['import_since_default'] = date('Y-m-01');

        // Language strings used by the template (OC3 needs them in $data).
        foreach (array(
            'heading_title', 'text_edit', 'text_enabled', 'text_disabled', 'text_general',
            'text_import', 'text_importing', 'text_test_run',
            'entry_status', 'entry_url', 'entry_secret', 'entry_source', 'entry_statuses',
            'entry_abandoned', 'entry_import_since',
            'help_url', 'help_secret', 'help_source', 'help_statuses', 'help_abandoned', 'help_import',
            'button_save', 'button_cancel', 'button_test', 'button_import',
        ) as $k) {
            $data[$k] = $this->language->get($k);
        }

        $data['header'] = $this->load->controller('common/header');
        $data['column_left'] = $this->load->controller('common/column_left');
        $data['footer'] = $this->load->controller('common/footer');

        $this->response->setOutput($this->load->view('extension/module/elyon_bridge', $data));
    }

    /** AJAX: historical backfill. Pushes existing orders since a date. */
    public function import() {
        $this->load->language('extension/module/elyon_bridge');
        $json = array();

        if (!$this->user->hasPermission('modify', 'extension/module/elyon_bridge')) {
            $json['error'] = $this->language->get('error_permission');
            $this->response->addHeader('Content-Type: application/json');
            $this->response->setOutput(json_encode($json));
            return;
        }

        require_once(DIR_SYSTEM . 'library/elyon/bridge.php');

        // Sanitize the date to Y-m-d; fall back to 1st of current month.
        $since = isset($this->request->post['since']) ? trim($this->request->post['since']) : '';
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $since)) {
            $since = date('Y-m-01');
        }

        // Statuses to import (default: saved send-statuses, else any real order).
        $statuses = $this->config->get('module_elyon_bridge_statuses');
        $status_sql = " AND order_status_id > 0";
        if (is_array($statuses) && count($statuses)) {
            $clean = array_map('intval', $statuses);
            $status_sql = " AND order_status_id IN (" . implode(',', $clean) . ")";
        }

        $sql = "SELECT order_id FROM `" . DB_PREFIX . "order`
                WHERE date_added >= '" . $this->db->escape($since) . " 00:00:00'"
                . $status_sql . " ORDER BY order_id ASC";
        $orders = $this->db->query($sql);

        $sent = 0;
        $failed = 0;
        foreach ($orders->rows as $r) {
            $res = elyon_bridge_send_order($this->registry, $r['order_id'], 'order');
            if (!empty($res['ok'])) {
                $sent++;
            } else {
                $failed++;
            }
        }

        $json['total'] = (int)$orders->num_rows;
        $json['sent'] = $sent;
        $json['failed'] = $failed;
        $json['since'] = $since;

        $this->response->addHeader('Content-Type: application/json');
        $this->response->setOutput(json_encode($json));
    }

    /** AJAX: connectivity + signature test. Sends a deliberately empty body. */
    public function test() {
        $this->load->language('extension/module/elyon_bridge');
        $json = array();

        if (!$this->user->hasPermission('modify', 'extension/module/elyon_bridge')) {
            $json['error'] = $this->language->get('error_permission');
            $this->response->addHeader('Content-Type: application/json');
            $this->response->setOutput(json_encode($json));
            return;
        }

        require_once(DIR_SYSTEM . 'library/elyon/bridge.php');
        // Empty-ish body: signature is verified BEFORE schema, so a 400 means the
        // URL is reachable and the secret is correct; 401 means a bad secret.
        $res = elyon_bridge_post($this->registry, array('mode' => 'order'));

        if (!empty($res['error']) && empty($res['code'])) {
            $json['error'] = 'Connection failed: ' . $res['error'];
        } elseif ($res['code'] == 401) {
            $json['error'] = 'Reachable, but the shared secret is wrong (401).';
        } elseif ($res['code'] == 400) {
            $json['success'] = 'Connected and signature OK. Ready to send orders.';
        } elseif (!empty($res['ok'])) {
            $json['success'] = 'Connected (HTTP ' . $res['code'] . ').';
        } else {
            $json['error'] = 'Unexpected response (HTTP ' . $res['code'] . '): ' . substr((string)$res['resp'], 0, 200);
        }

        $this->response->addHeader('Content-Type: application/json');
        $this->response->setOutput(json_encode($json));
    }

    protected function validate() {
        if (!$this->user->hasPermission('modify', 'extension/module/elyon_bridge')) {
            $this->error['warning'] = $this->language->get('error_permission');
        }
        $url = isset($this->request->post['module_elyon_bridge_url']) ? trim($this->request->post['module_elyon_bridge_url']) : '';
        if ($this->request->post['module_elyon_bridge_status'] && $url === '') {
            $this->error['url'] = $this->language->get('error_url');
        }
        return !$this->error;
    }

    /** Register the storefront events when the module is installed. */
    public function install() {
        $this->load->model('setting/event');
        $this->model_setting_event->deleteEventByCode('elyon_bridge_order');
        $this->model_setting_event->deleteEventByCode('elyon_bridge_history');
        $this->model_setting_event->addEvent(
            'elyon_bridge_order',
            'catalog/model/checkout/order/addOrder/after',
            'extension/module/elyon_bridge/onOrderAdded'
        );
        $this->model_setting_event->addEvent(
            'elyon_bridge_history',
            'catalog/model/checkout/order/addOrderHistory/after',
            'extension/module/elyon_bridge/onOrderHistory'
        );
    }

    /** Remove the storefront events when uninstalled. */
    public function uninstall() {
        $this->load->model('setting/event');
        $this->model_setting_event->deleteEventByCode('elyon_bridge_order');
        $this->model_setting_event->deleteEventByCode('elyon_bridge_history');
    }
}
