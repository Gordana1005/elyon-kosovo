# RESUME.md — retired, do not follow

This file was the one-off handoff guide for standing up the **Bulgarian** system
(`github.com/Gordana1005/elyoncrm`) in 2026. Every step in it was completed long ago.

It was emptied on 2026-08-04 because following it was actively dangerous: it instructed the
reader to open a shell in `c:\Users\Mile\Desktop\elyoncrm` and run `supabase link` / `db push`
against that project. **That folder is the live Bulgarian business, which this repository must
never touch** — it is the exact move that caused the 2026-06-30 Bulgarian outage. It also
referenced `scripts/create-admin-users.mjs`, which deletes existing users before recreating them
and has no target tripwire.

The original text is preserved in git history if it is ever needed for provenance.

**Where to look instead**

| For | Read |
|---|---|
| The rules of this repository | `CLAUDE.md` |
| Current state, what is done, what is open | `MACEDONIA-STATUS.md` |
| Security posture and findings | `docs/SECURITY-AUDIT-2026-08-04.md` |
| Keys, admin logins, the PAT | `docs/VAULT.md` (gitignored) |
| Creating a staff login | `node scripts/create-user-mk.mjs --help` |
| Applying a migration | `node scripts/apply-migration-mk.mjs <file.sql>` |

Before any state-changing command, run `node scripts/assert-mk-target.mjs`.
