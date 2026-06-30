<?php
/**
 * elyon-health.php — read-only PBX/VPS health collector for the Elyon CRM
 * "VOIP Health" dashboard. Deploy to /var/www/html/elyon-health.php on the PBX.
 *
 * SECURITY MODEL (same trust boundary as elyon-rec.php):
 *  - HTTP mode requires an HMAC-signed request:  ?mode=health&exp=<epoch>&sig=<hex>
 *      sig = HMAC_SHA256( file_get_contents('/etc/asterisk/elyon-rec.key'), "health|<exp>" )
 *    and <exp> must be in the future (short-lived). NO request input ever reaches a shell.
 *  - CLI mode (php elyon-health.php) needs no signature — invocation is inherently local
 *    and trusted; the cron uses this to push snapshots.
 *  - Only a FIXED set of read-only commands runs. Privileged ones go through `sudo -n`
 *    with a narrow NOPASSWD sudoers entry (see MONITORING.md). Anything that fails
 *    degrades to null — partial data still flows.
 */

header('Content-Type: application/json');

$IS_CLI = (php_sapi_name() === 'cli');

if (!$IS_CLI) {
    $key = @trim(@file_get_contents('/etc/asterisk/elyon-rec.key'));
    $exp = isset($_GET['exp']) ? (int)$_GET['exp'] : 0;
    $sig = isset($_GET['sig']) ? (string)$_GET['sig'] : '';
    $mode = isset($_GET['mode']) ? (string)$_GET['mode'] : '';
    if ($key === '' || $mode !== 'health' || $exp < time()) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'unauthorized']);
        exit;
    }
    $expected = hash_hmac('sha256', "health|$exp", $key);
    if (!hash_equals($expected, $sig)) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'bad signature']);
        exit;
    }
}

/** Run a fixed command, return trimmed stdout or null on any failure. */
function sh($cmd) {
    $out = @shell_exec($cmd . ' 2>/dev/null');
    if ($out === null) return null;
    $out = trim($out);
    return $out === '' ? null : $out;
}

$MONITOR = '/var/spool/asterisk/monitor';

// ── disk ──────────────────────────────────────────────────────────────────
$total = @disk_total_space('/');
$free  = @disk_free_space('/');
$disk = null;
if ($total && $free !== false) {
    $used = $total - $free;
    $recB = (int)preg_replace('/\s.*$/', '', (string)sh("du -sb $MONITOR")); // bytes
    $disk = [
        'total' => (int)$total, 'used' => (int)$used, 'free' => (int)$free,
        'pct' => (int)round($used / $total * 100),
        'rec_bytes' => $recB ?: null,
        'rec_human' => sh("du -sh $MONITOR | cut -f1"),
    ];
}

// ── memory (from /proc/meminfo) ─────────────────────────────────────────────
$mem = null;
$mi = @file_get_contents('/proc/meminfo');
if ($mi) {
    preg_match('/MemTotal:\s+(\d+)/', $mi, $mt);
    preg_match('/MemAvailable:\s+(\d+)/', $mi, $ma);
    if (!empty($mt[1]) && isset($ma[1])) {
        $tot = (int)$mt[1] * 1024; $avail = (int)$ma[1] * 1024; $u = $tot - $avail;
        $mem = ['total' => $tot, 'used' => $u, 'free' => $avail, 'pct' => (int)round($u / $tot * 100)];
    }
}

// ── load ────────────────────────────────────────────────────────────────────
$load = null;
$la = @file_get_contents('/proc/loadavg');
if ($la) { $p = explode(' ', $la); $load = ['1' => (float)$p[0], '5' => (float)$p[1], '15' => (float)$p[2]]; }

// ── asterisk process ────────────────────────────────────────────────────────
$astPid = sh("pgrep -o asterisk");
$astUp = $astPid ? sh("ps -o etimes= -p $astPid") : null;
$asterisk = ['running' => $astPid !== null, 'uptime_seconds' => $astUp !== null ? (int)$astUp : null];

// ── lines in use (active calls) ─────────────────────────────────────────────
// `core show channels` footer: "N active channels / M active calls".
// php-fpm runs as the `asterisk` user (see RUNBOOK), so asterisk -rx works directly.
$lines = ['active' => null, 'max' => 10, 'channels' => []];
$ch = sh("/usr/sbin/asterisk -rx 'core show channels'");
if ($ch !== null) {
    if (preg_match('/(\d+)\s+active call/', $ch, $m)) $lines['active'] = (int)$m[1];
    // Per-channel detail (best-effort): concise = chan!context!exten!...!duration
    $conc = sh("/usr/sbin/asterisk -rx 'core show channels concise'");
    if ($conc) {
        foreach (explode("\n", $conc) as $row) {
            $f = explode('!', $row);
            if (count($f) < 2) continue;
            $lines['channels'][] = [
                'ext' => $f[2] ?? null,
                'dialed' => $f[2] ?? null,
                'duration' => isset($f[11]) ? (int)$f[11] : 0,
                'state' => $f[4] ?? '',
            ];
        }
    }
}

// ── A1 trunk reachability (TCP-connect to the SBC; independent of qualify) ──
$trunk = ['name' => 'a1-bulgaria', 'reachable' => false, 'rtt_ms' => null];
$t0 = microtime(true);
$fp = @fsockopen('195.149.255.243', 5061, $errno, $errstr, 3);
if ($fp) { $trunk['reachable'] = true; $trunk['rtt_ms'] = (int)round((microtime(true) - $t0) * 1000); fclose($fp); }

// ── agent extensions registered (1001-1020) ────────────────────────────────
$extensions = [];
$contacts = sh("/usr/sbin/asterisk -rx 'pjsip show contacts'");
for ($e = 1001; $e <= 1020; $e++) {
    if ($contacts === null) break;
    // A registered webrtc ext appears as "Contact:  100x/..." with Avail.
    $reg = (strpos($contacts, "$e/") !== false) || preg_match("/\b$e\b.*Avail/", $contacts);
    if (strpos($contacts, (string)$e) !== false) $extensions[] = ['ext' => (string)$e, 'registered' => (bool)$reg];
}

// ── recordings today ────────────────────────────────────────────────────────
$today = $MONITOR . '/' . date('Y/m/d');
$recToday = ['count' => 0, 'newest_mtime' => null, 'newest_age_seconds' => null];
if (is_dir($today)) {
    $newest = 0; $cnt = 0;
    foreach (@glob("$today/*.wav") ?: [] as $f) {
        if (filesize($f) <= 2000) continue; // skip empty/failed
        $cnt++; $mt = filemtime($f); if ($mt > $newest) $newest = $mt;
    }
    $recToday['count'] = $cnt;
    if ($newest) { $recToday['newest_mtime'] = $newest; $recToday['newest_age_seconds'] = time() - $newest; }
}

// ── fail2ban (attacks) ──────────────────────────────────────────────────────
$attacks = ['jail' => 'asterisk', 'banned_count' => null, 'banned_ips' => []];
$f2b = sh("sudo -n /usr/bin/fail2ban-client status asterisk");
if ($f2b) {
    if (preg_match('/Currently banned:\s*(\d+)/', $f2b, $m)) $attacks['banned_count'] = (int)$m[1];
    if (preg_match('/Banned IP list:\s*(.*)/', $f2b, $m)) {
        $ips = preg_split('/\s+/', trim($m[1]));
        $attacks['banned_ips'] = array_values(array_filter($ips));
    }
}

// ── recent errors (filtered tail) ───────────────────────────────────────────
$errors = [];
$astErr = sh("tail -n 500 /var/log/asterisk/full | grep -E 'ERROR|WARNING' | tail -n 25");
if ($astErr) foreach (explode("\n", $astErr) as $l) $errors[] = ['src' => 'asterisk', 'line' => mb_substr($l, 0, 300)];
$httpErr = sh("tail -n 300 /var/log/httpd/pbx_error.log | grep -iE 'error' | tail -n 10");
if ($httpErr) foreach (explode("\n", $httpErr) as $l) $errors[] = ['src' => 'apache', 'line' => mb_substr($l, 0, 300)];

echo json_encode([
    'ok' => true,
    'ts' => time(),
    'disk' => $disk,
    'mem' => $mem,
    'load' => $load,
    'asterisk' => $asterisk,
    'lines' => $lines,
    'trunk' => $trunk,
    'extensions' => $extensions,
    'recordings_today' => $recToday,
    'attacks' => $attacks,
    'errors' => $errors,
]);
