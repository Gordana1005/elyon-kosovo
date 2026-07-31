# Elyon PBX — Sofia VPS infrastructure

> Built 2026-05-09; **LIVE in production** since ~June 2026. Asterisk + FreePBX at `pbx.elyoncall.com`, A1 "Business Voice" SIP trunk live (Path II), browser softphone (`RealVoipEngine`/sip.js), call recordings, and the `/voip-health` dashboard all in production. This doc is the operational reference — read [CLAUDE.md](CLAUDE.md) for broader context and `docs/telephony/RUNBOOK.md` before touching the PBX.

---

## VPS facts

| | |
|---|---|
| Provider | AlphaVPS — €6.99/mo |
| Location | Sofia, Bulgaria (AS203380 DA International Group, postal 1000) |
| OS | AlmaLinux 8.10 (Cerulean Leopard) |
| Public IP | `104.152.48.222` |
| Hostname / FQDN | `pbx.elyoncall.com` |
| Specs | 2 vCPU · 8 GB RAM · 60 GB SSD · 5.86 TB bandwidth |

**No secrets in this file.** Credentials (root password for AlphaVPS panel + noVNC, FreePBX admin) live in Mile's password manager only. The SSH private key is at `C:\Users\Mile\.ssh\elyon_vps` on Mile's Windows machine — that's the only authorized key on the VPS.

---

## Access

### SSH (key-only — password auth disabled)

```powershell
ssh -i $env:USERPROFILE\.ssh\elyon_vps root@104.152.48.222
```

If the key is ever lost: log in via AlphaVPS noVNC console with the root password (in Mile's password manager), paste a new public key into `/root/.ssh/authorized_keys`.

### FreePBX web UI

→ **https://pbx.elyoncall.com** — admin user created on first visit.

### AlphaVPS panel

For reboots, OS rebuild, password resets, noVNC console: log in at alphavps.com → Services → "elyon".

---

## What's installed

| Service | Port(s) | Notes |
|---|---|---|
| sshd | 22/tcp | Key-only, fail2ban guarded |
| Apache (httpd) | 80, 443/tcp | FreePBX UI; 80 → 443 redirect; HSTS 6 mo |
| Asterisk (chan_pjsip) | 5060/udp+tcp, 5061/tcp | SIP signalling (UDP/TCP/TLS) |
| Asterisk WSS | 8089/tcp (localhost) | WebRTC endpoint. Agents connect to **`wss://pbx.elyoncall.com/ws`** on **443**, which Apache reverse-proxies to `127.0.0.1:8089` (`timeout=7200`). The `:8089` form is historical — do not use it. |
| RTP media | 10000–20000/udp | Audio streams |
| MariaDB | 3306 (local only) | FreePBX state |
| php-fpm | unix socket | PHP runtime for Apache |

All five auto-start on boot (`httpd mariadb fail2ban php-fpm freepbx`).

### Versions

- Asterisk **20.19.0 LTS** (built from source: PJSIP + Opus + WSS + DTLS-SRTP)
- FreePBX **16.0.45**
- PHP **7.4.33** (Remi)
- MariaDB **10.3.39**
- Apache **2.4.37** with mod_ssl

---

## TLS

Let's Encrypt cert for `pbx.elyoncall.com`, auto-renews via certbot. Renewal hook at `/etc/letsencrypt/renewal-hooks/deploy/asterisk-certs.sh` copies the renewed cert into `/etc/asterisk/certs/asterisk.pem` (Asterisk reads it for WSS) and reloads Apache + Asterisk PJSIP.

```
Live cert:            /etc/letsencrypt/live/pbx.elyoncall.com/
Asterisk WSS cert:    /etc/asterisk/certs/asterisk.pem
Initial expiry:       2026-08-07 (auto-renews ~30 days before)
Issuer:               C = US, O = Let's Encrypt, CN = R12
```

---

## Common ops commands (run as root via SSH)

```bash
# FreePBX
fwconsole start | stop | restart | reload
fwconsole ma list                          # list installed modules
fwconsole ma installall                    # install all available modules
fwconsole chown                            # fix ownership

# Asterisk CLI
asterisk -rvvv                             # interactive console (Ctrl+C to exit)
asterisk -rx "core show version"
asterisk -rx "pjsip show endpoints"
asterisk -rx "pjsip show registrations"
asterisk -rx "http show status"
asterisk -rx "core show channels"

# Cert
certbot certificates                       # show all certs
certbot renew --dry-run                    # test renewal

# Service status
systemctl status httpd php-fpm mariadb fail2ban freepbx

# fail2ban
fail2ban-client status sshd                # see banned IPs
```

Logs:
- Asterisk: `/var/log/asterisk/full`
- Apache: `/var/log/httpd/{pbx_error.log, pbx_access.log, error_log}`
- FreePBX: `/var/log/asterisk/freepbx.log`

---

## Pre-staged for A1 trunk

The custom PJSIP transport for WebRTC is already wired:

```
/etc/asterisk/pjsip.transports_custom.conf
   [wss-transport] type=transport protocol=wss bind=0.0.0.0
```

For trunk/extension changes, don't touch the file system — go to **FreePBX GUI → Connectivity → Trunks / Extensions**. Reference templates used during go-live remain on the VPS at `/root/`:

```
/root/A1-TRUNK-TEMPLATE.txt          ← exact fields for A1 trunk
/root/WEBRTC-EXTENSION-TEMPLATE.txt  ← per-agent extension setup (3 agents)
```

scp them down with:
```powershell
scp -i $env:USERPROFILE\.ssh\elyon_vps root@104.152.48.222:/root/A1-TRUNK-TEMPLATE.txt .
scp -i $env:USERPROFILE\.ssh\elyon_vps root@104.152.48.222:/root/WEBRTC-EXTENSION-TEMPLATE.txt .
```

---

## History — go-live (completed)

The trunk is live; this is the record of how we got there (no longer a to-do list):

1. Ran the A1 6-question call and resolved the path → **Path II** (separate SIP trunk product; our PBX is its own entity registering A1's trunk).
2. Plugged A1 credentials into FreePBX (Connectivity → Trunks) and made the first real call: browser → A1 → BG mobile.
3. Swapped the frontend to the real WebRTC client — `src/lib/voip/RealVoipEngine.ts` (sip.js) behind `VoipContext`. The old `src/lib/mockCalls.ts` is now dead.

Carrier note: Zadarma was evaluated in parallel as a fallback (same FreePBX/Sofia-VPS architecture, only trunk creds/DIDs differ). **A1 is the production carrier.**

---

## Things NOT to break

- **`/etc/asterisk/pjsip.transports_custom.conf`** — if FreePBX overwrites it, WebRTC dies. Use only `*_custom.conf` files for custom additions.
- **Apache user/group must be `asterisk`** — FreePBX requires this. If you reinstall httpd or php-fpm and they revert to `apache`, FreePBX breaks.
- **PHP 7.4** — FreePBX 16 doesn't run on 8.x. Don't `dnf module reset` PHP without pinning Remi 7.4 again.
- **SELinux is `Permissive`**, not Disabled. Don't switch to Enforcing without testing — FreePBX has many SELinux fights.
- **Don't disable fail2ban** — port 22 takes ~100 brute-force attempts per hour from random scanners.
- **Don't touch `/etc/httpd/conf.d/pbx-elyoncall.conf`** without testing — that's the vhost wiring HTTPS for the FreePBX UI.
- **The php-fpm pool runs as `asterisk:asterisk`** — `/etc/php-fpm.d/www.conf` has `user/group/listen.owner/listen.group` all set to asterisk. If you reinstall php-fpm, redo this or HTTP returns 503.

---

## Cost recap

| Item | Cost |
|---|---|
| AlphaVPS Sofia VPS | €6.99 / month |
| `elyoncall.com` domain (Namecheap) | ~€10–15 / year |
| Let's Encrypt cert | free, auto-renew |
| Asterisk + FreePBX | free, open source |
| **Total fixed cost** | **~€84/year** |

Plus whatever A1 charges per channel/DID once the trunk is wired.

---

## When the A1 path resolves

The full architecture for browser → PBX → A1 → BG-mobile works as:

```
[Agent in Skopje, Chrome]
     │  WebRTC (WSS, encrypted)
     ▼
[Sofia VPS — Asterisk + FreePBX]   ← we are here
     │  SIP/RTP (over A1's network, BG-IP origin)
     ▼
[A1 Cloud PBX or A1 SIP trunk]
     │  PSTN
     ▼
[Bulgarian customer's mobile]
```

The Sofia BG IP is what makes A1 see the registration as "local" — solves the original problem of cross-border SIP being flaky. Same architecture Mile's previous employer (MonetizeAd) used — the Ziff CRM had a BG-hosted PBX that made the call leg appear domestic.

---

*Built 2026-05-09. If something breaks at 3 AM, the very first thing to try is `fwconsole restart`. Second is `systemctl restart httpd php-fpm`.*
