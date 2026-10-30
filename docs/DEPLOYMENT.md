# Shipping a build to Luke, and deploying SSAA on ssaainc.com

Two separate things:

1. **A ship tag**: a named, frozen snapshot of the code that Luke can download and run on his own computer. This is how he previews a version before it goes live.
2. **A deployment**: the app running on a server at a real address (for example `app.ssaainc.com`) that anyone can sign in to.

---

## 1. Send Luke a ship tag

A tag is a permanent name for one commit, such as `luke-preview-2026-10-30`. It never moves, so "the version I sent you on the 30th" always means the same code.

### Steps (about 10 minutes)

1. **Commit and push the work** to `bao`, then merge it into `main` the way the team usually does. Never commit `.env` files: they hold passwords and keys.
2. **Run the checks.**
   - `backend`: `npx vitest run`
   - `web`: `npx tsc -b` and `npm run build`
3. **Tag the commit and push the tag** to the UMD repo:
   ```bash
   git tag -a luke-preview-2026-10-30 -m "Preview for Luke: Weekly view, operator dashboard, correspondence"
   git push umd luke-preview-2026-10-30
   ```
4. **Make a download** of exactly that tag. `git archive` leaves out `.env`, `node_modules` and anything else Git ignores:
   ```bash
   git archive --format=zip --prefix=SSAA/ -o ../SSAA-for-Luke-2026-10-30.zip luke-preview-2026-10-30
   ```
5. **Publish it as a GitHub release**, so Luke gets one link with the notes and the zip:
   ```bash
   gh release create luke-preview-2026-10-30 ../SSAA-for-Luke-2026-10-30.zip \
     -R UMDMSISCapstone/F2026-501-4-SSAA \
     --title "Preview for Luke, Oct 30" --notes-file release-notes.md --prerelease
   ```
   If Luke can't see the UMD repo, email him the zip instead.
6. **Send Luke a short message** with:
   - the release link (or the zip);
   - "How to run it": install Node 22 and MySQL 8, copy `backend/.env.example` to `backend/.env`, then run `.\dev.ps1` (or `npm install` and `npm run dev` in `backend` and in `web`);
   - the demo sign-ins after `npm run db:seed-showcase` in `backend` (all use password `Test1234!`):
     - **GC Greg** (`bnguye26@umd.edu`), who is also the **owner operator**, so the Operator Dashboard link is in his header
     - **Subcontractor Steve** (`baotn.it@gmail.com`)
     - **SSAA Operator** (`operator@example.com`), a main operator with no company
   - what's new, and what you want feedback on.

The earlier preview was sent this way: tag `luke-preview-2026-10-18` and `SSAA-for-Luke-2026-10-18.zip`.

---

## 2. Deploy on the domain

### What runs where

```
Browser ──https──▶ app.ssaainc.com (Caddy on one small server)
                    ├─ /            → the built web app (web/dist, plain files)
                    ├─ /api/*       → Node backend on localhost:8000 (the /api prefix is removed)
                    ├─ /socket.io/* → the same backend (live updates)
                    └─ /uploads/*   → the same backend (photos)
                    Node backend ──▶ MySQL (managed database)
                    Node backend ──▶ Resend (email), Anthropic (AI, optional)
```

This copies the dev setup (`web/vite.config.ts` proxies the same three paths), so the web code needs no changes: it always calls `/api/...` on its own address.

**Use `app.ssaainc.com`** so Luke's current `ssaainc.com` site keeps working. Moving the app to the main address later is only a DNS change.

### Recommended setup (about $25–40 a month)

| Piece | Recommended | Why |
| --- | --- | --- |
| Server | One small Linux VM: DigitalOcean Droplet, AWS Lightsail or Hetzner, 2 GB RAM, Ubuntu 24.04 | Runs Node and Caddy. Live updates need a long-running server, which rules out "serverless" hosts. |
| Database | Managed MySQL 8 (DigitalOcean Managed MySQL, or AWS RDS) | Daily backups and updates are handled for you. The backend already speaks MySQL. |
| Web server and HTTPS | Caddy | Gets and renews the HTTPS certificate automatically; one short config file. |
| Process manager | pm2 or systemd | Restarts the backend if it crashes or the server reboots. |
| Email | Resend with ssaainc.com verified | Already built in. Today it only reaches the Resend account owner. |

A single host such as Render or Railway also works (one web service plus MySQL) and is less hands-on, but it costs a bit more and needs WebSockets turned on.

### One-time steps

1. **Who owns the accounts.** Luke should own the hosting, database, domain and Resend accounts, with the team added as members. Then nothing breaks when the semester ends.
2. **Create the database.**
   - Create database `ssaa` and a user for the app.
   - Allow connections only from the server.
   - On first start the backend creates all tables from `backend/db/mysql/schema.sql`.
3. **Create the server.**
   - Install Node 22, Git, Caddy and pm2.
   - Clone the repo and check out the release tag.
   - Run `npm ci` in `backend` and `web`, then `npm run build` in `web`.
4. **Write `backend/.env` on the server.** It never goes in Git.

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `PORT` | `8000` |
   | `SECRET_KEY`, `JWT_SECRET_KEY` | Two new long random strings, e.g. from `openssl rand -hex 32`. Never reuse the dev ones. |
   | `DB_CLIENT` | `mysql` |
   | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | From the managed database |
   | `CORS_ORIGINS` | `https://app.ssaainc.com` |
   | `RESEND_API_KEY` | A production Resend key |
   | `EMAIL_FROM` | `SSAA <noreply@ssaainc.com>` |
   | `EXPOSE_DEV_CODES` | `false` (reset codes are never shown in responses) |
   | `GOOGLE_CLIENT_ID` | Optional. Add `https://app.ssaainc.com` as an authorised origin in Google Cloud. |
   | `ANTHROPIC_API_KEY` | Optional. Turns on the AI part of the schedule recommender. |
   | `UPLOAD_DIR` | A folder outside the code, e.g. `/var/ssaa/uploads`, so redeploys keep photos |

5. **Start the backend**: `pm2 start "npm run start" --name ssaa-api --cwd backend`, then `pm2 save` and `pm2 startup`.
   - `npm run start` runs `tsx src/server.ts` without file watching, which is fine for this size of app.
6. **Configure Caddy** in `/etc/caddy/Caddyfile`:
   ```
   app.ssaainc.com {
     encode gzip
     handle_path /api/* {
       reverse_proxy localhost:8000
     }
     handle /socket.io/* {
       reverse_proxy localhost:8000
     }
     handle /uploads/* {
       reverse_proxy localhost:8000
     }
     handle {
       root * /srv/ssaa/web/dist
       try_files {path} /index.html
       file_server
     }
   }
   ```
   `handle_path` removes `/api` the same way the dev proxy does. `try_files … /index.html` lets links like `/operator` open directly.
7. **Set up DNS** (wherever ssaainc.com's DNS is managed):
   - add an **A record** `app` pointing to the server's IP;
   - Caddy gets the HTTPS certificate on its own within a minute.
8. **Set up email.**
   - In Resend → Domains, add `ssaainc.com`.
   - Add the DNS records it shows: SPF (TXT), DKIM (TXT or CNAME) and the return-path MX.
   - Once it says Verified, set `EMAIL_FROM`.
   - From then on the Operator Dashboard → Correspondence → Log shows real "Sent" rows. "Send test to me" on any template checks it end to end.
9. **Create the first accounts.**
   - Luke signs up at `https://app.ssaainc.com/signup`.
   - On the server, run `npm run make-operator -- luke@… --level=owner` in `backend`.
   - Don't run the demo seed on production.
10. **Back up.** Managed MySQL keeps daily backups; also turn on point-in-time restore if offered. Back up `UPLOAD_DIR` too, e.g. with the provider's volume snapshots.

### Shipping an update later

```bash
git fetch --tags && git checkout <new tag>
cd backend && npm ci && pm2 restart ssaa-api
cd ../web && npm ci && npm run build
```

Schema changes apply themselves when the backend starts: `schema.sql` only adds what's missing.

### Before launch

- [ ] Run `npm audit` and fix what it finds (#63).
- [ ] Confirm `EXPOSE_DEV_CODES` is off and the secrets are new.
- [ ] ssaainc.com is verified in Resend, and a test email arrives.
- [ ] Sign in on a phone over HTTPS, and check live updates by watching a request appear on a second device.
- [ ] The Operator Dashboard shows no "email not set up" banner.
- [ ] Restore a backup once, to prove the backups work.
