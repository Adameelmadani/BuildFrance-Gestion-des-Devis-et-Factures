# Build France - Gestion des devis et factures

Web application for creating Build France SAS quotes (*devis*) and invoices (*factures*) in the company's own layout.
It runs on a server: everyone in the team uses it from a browser, with their own login, and all data is stored centrally in a database.

- **Frontend**: HTML / CSS / vanilla JavaScript (no build step), in [`public/`](public/)
- **Backend**: Node.js + Express, in [`server/`](server/)
- **Database**: SQLite (a single file, `data/buildfrance.sqlite`), through `better-sqlite3`
- **Production stack**: Ubuntu/Debian + Node.js 22 LTS + systemd + Nginx + Let's Encrypt (no Docker)

---

## Contents

1. [Features](#features)
2. [How it works](#how-it-works)
3. [Run it locally (development)](#run-it-locally-development)
4. [Deploy on a server (production)](#deploy-on-a-server-production)
5. [Move your existing data from the old version](#move-your-existing-data-from-the-old-version)
6. [User accounts](#user-accounts)
7. [Backups and restore](#backups-and-restore)
8. [Updating the application](#updating-the-application)
9. [Configuration reference](#configuration-reference)
10. [Troubleshooting](#troubleshooting)
11. [Security notes](#security-notes)
12. [API reference](#api-reference)

---

## Features

- **Editor** with a live A4 preview, multiple lines, units, VAT 20 / 10 / 5.5 / 0 % or reverse charge (*autoliquidation*, construction subcontracting).
- **Quote → invoice** in one click: full invoice or deposit invoice (*acompte*, 35 % by default), quote reference copied automatically.
- **Automatic numbering**: format `{NN}{JJ}{MM}{AAAA}` (e.g. `0129102026` = 1st document of 29/10/2026), configurable in *Paramètres*.
  The server guarantees a number is never given out twice, even when two people create a document at the same time.
- **Client address book**, statuses (draft, sent, accepted, paid…), search, duplication.
- **PDF download** and printing.
- **Settings**: company details, SIRET, VAT number, IBAN, legal notices, logo.
- **Multi-user**: login page, sessions, password change, data shared between all computers.
- **Backups**: JSON export/import from the interface, plus automatic SQLite backups on the server.

## How it works

```
 Browser (any computer / phone)
        │  HTTPS
        ▼
 Nginx  :443  ── TLS certificate (Let's Encrypt), gzip, forwards to ──┐
                                                                      ▼
                                      Node.js / Express  127.0.0.1:3000   (systemd service "buildfrance")
                                        ├─ /login, /, /css, /js, /assets   static files from public/
                                        └─ /api/*                          JSON API (login required)
                                                │
                                                ▼
                                      SQLite  data/buildfrance.sqlite
```

Project layout:

```
public/              Frontend served to the browser
  index.html         The application (requires login)
  login.html         Login page
  js/store.js        Business logic (totals, numbering…) - shared by the browser AND the server
  js/api.js          Calls to the backend API
  js/app.js          Screens, editor, routing
  js/templates.js    A4 quote / invoice templates
server/
  index.js           Express server: pages, API, security headers
  db.js              SQLite schema, validation, data access
  auth.js            Users, password hashing (scrypt), sessions
  config.js          Settings read from environment variables / .env
scripts/
  user.js            Create / list / remove users, reset passwords
  backup.js          Hot backup of the database with rotation
deploy/
  buildfrance.service       systemd unit
  nginx-buildfrance.conf    Nginx site
.env.example         Configuration template
exemples/            Reference PDFs (not served)
```

---

## Run it locally (development)

Requires **Node.js 22 or newer** ([nodejs.org](https://nodejs.org)).

```bash
npm install
```

```bash
cp .env.example .env
```

In `.env`, set `COOKIE_SECURE=false` (local tests run over plain `http://`, and secure cookies only work over HTTPS).

Create your account (you will be asked for a password, 8 characters minimum):

```bash
npm run user -- add adam
```

Start the server (`npm run dev` also restarts it automatically when you edit a server file):

```bash
npm start
```

Open <http://localhost:3000> and log in.

---

## Deploy on a server (production)

These steps target **Ubuntu 22.04 / 24.04 or Debian 12** on any VPS (OVH, Scaleway, Hetzner, DigitalOcean…). 1 vCPU and 1 GB RAM are plenty.
Commands are run as a user with `sudo`. Replace `devis.example.com` with your own domain and `adam` with your user name.

### 0. Before you start

- A server with SSH access.
- A domain or sub-domain (e.g. `devis.buildfrance.fr`) with a DNS **A record** pointing to the server's public IP address.
  Check with `ping devis.example.com` that it resolves to your server before step 7.

### 1. Update the system and open the firewall

```bash
sudo apt update && sudo apt upgrade -y
```

```bash
sudo apt install -y git nginx ufw
```

```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

Port 3000 (Node) stays closed to the outside: only Nginx talks to it.

### 2. Install Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt install -y nodejs
```

```bash
node -v
```

It must print `v22.x` or newer. (`better-sqlite3` downloads a prebuilt binary during install. On an unusual CPU/OS it compiles instead and then needs `sudo apt install -y build-essential python3`.)

### 3. Create a system user and get the code

The app runs under a dedicated account with no login shell and no rights outside its folders.

```bash
sudo useradd --system --home /opt/buildfrance --shell /usr/sbin/nologin buildfrance
```

```bash
sudo git clone <URL-OF-THIS-REPOSITORY> /opt/buildfrance
```

(No Git access from the server? Copy the project folder instead, without `node_modules/` and `data/`, for example with `scp -r` or WinSCP, to `/opt/buildfrance`.)

```bash
cd /opt/buildfrance && sudo npm ci --omit=dev
```

Create the folders the app writes to and hand them to the service account:

```bash
sudo mkdir -p /opt/buildfrance/data /opt/buildfrance/backups && sudo chown -R buildfrance:buildfrance /opt/buildfrance/data /opt/buildfrance/backups && sudo chmod 750 /opt/buildfrance/data /opt/buildfrance/backups
```

### 4. Configure

```bash
sudo cp /opt/buildfrance/.env.example /opt/buildfrance/.env
```

```bash
sudo nano /opt/buildfrance/.env
```

The defaults are right for this setup (Node on `127.0.0.1:3000` behind Nginx, HTTPS-only cookies, Paris time zone). See [Configuration reference](#configuration-reference).
Then restrict the file:

```bash
sudo chown root:buildfrance /opt/buildfrance/.env && sudo chmod 640 /opt/buildfrance/.env
```

### 5. Create the first user

Run it as `buildfrance` so the database file is created with the right owner:

```bash
cd /opt/buildfrance && sudo -u buildfrance node scripts/user.js add adam
```

### 6. Start the app as a systemd service

```bash
sudo cp /opt/buildfrance/deploy/buildfrance.service /etc/systemd/system/buildfrance.service
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now buildfrance
```

```bash
sudo systemctl status buildfrance
```

It should say `active (running)`. Quick check from the server itself:

```bash
curl -s http://127.0.0.1:3000/api/health
```

Expected answer: `{"ok":true}`. The service starts automatically at boot and restarts if it crashes.

### 7. Put Nginx in front

```bash
sudo cp /opt/buildfrance/deploy/nginx-buildfrance.conf /etc/nginx/sites-available/buildfrance
```

```bash
sudo sed -i 's/devis.example.com/YOUR-DOMAIN/' /etc/nginx/sites-available/buildfrance
```

```bash
sudo ln -s /etc/nginx/sites-available/buildfrance /etc/nginx/sites-enabled/buildfrance && sudo rm -f /etc/nginx/sites-enabled/default
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Enable HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
```

```bash
sudo certbot --nginx -d YOUR-DOMAIN
```

Certbot installs the certificate, redirects HTTP to HTTPS, and renews automatically (`sudo certbot renew --dry-run` to test renewal).

> HTTPS is required: with `COOKIE_SECURE=true` (the default in `.env.example`), the browser only sends the login cookie over HTTPS.
> If you really must test over plain HTTP first, set `COOKIE_SECURE=false` temporarily and restart the service.

### 9. Done

Open `https://YOUR-DOMAIN`, log in, then go to **Paramètres** to check the company details (address, SIRET, IBAN, logo…).
Then set up the [automatic backups](#automatic-backups-cron).

---

## Move your existing data from the old version

The previous version stored everything inside the browser of one computer. To bring that data to the server:

1. On the computer you used before, open the old `index.html` → **Paramètres** → **Exporter la sauvegarde**. You get a `buildfrance-sauvegarde-YYYY-MM-DD.json` file.
2. Log in to the new server version → **Paramètres** → **Importer une sauvegarde**, pick that file and confirm.

Import **replaces all** data on the server (documents, clients, settings) for every user, so do it once, at the start.

---

## User accounts

Each person gets their own login. All users see and edit the same documents (one company, one shared workspace).
Manage accounts from the server, in `/opt/buildfrance`:

| Action | Command |
| --- | --- |
| Create a user | `sudo -u buildfrance node scripts/user.js add marie` |
| List users | `sudo -u buildfrance node scripts/user.js list` |
| Reset a forgotten password (also logs that user out everywhere) | `sudo -u buildfrance node scripts/user.js passwd marie` |
| Delete a user | `sudo -u buildfrance node scripts/user.js remove marie` |

In development, `npm run user -- add marie` does the same.
Users can change their own password in **Paramètres → Mon compte**, where there is also a logout button (also in the page footer).
After 10 failed login attempts from the same IP address, logins from that address are blocked for 15 minutes.

---

## Backups and restore

Everything lives in **one file**: `/opt/buildfrance/data/buildfrance.sqlite` (plus `-wal` / `-shm` companion files while the app runs).
Two complementary kinds of backup are available:

- **Database backups** (`npm run backup`): exact, complete copies, to restore the server.
- **JSON export** (**Paramètres → Exporter la sauvegarde**): readable file, any user can download it, can be imported back.

### Manual backup

```bash
cd /opt/buildfrance && sudo -u buildfrance node scripts/backup.js
```

It writes `backups/buildfrance-YYYY-MM-DD_HHMMSS.sqlite` safely while the app keeps running, and only keeps the 30 most recent (`BACKUP_KEEP`).

### Automatic backups (cron)

Every night at 02:30:

```bash
echo '30 2 * * * buildfrance cd /opt/buildfrance && /usr/bin/node scripts/backup.js >> /opt/buildfrance/backups/backup.log 2>&1' | sudo tee /etc/cron.d/buildfrance-backup
```

**Also copy the backups off the server** (another machine, NAS, S3, Backblaze…), because a backup on the same disk does not survive the loss of the server. For example, from another Linux machine, every night:

```bash
rsync -az user@YOUR-SERVER:/opt/buildfrance/backups/ ~/buildfrance-backups/
```

Most VPS providers also offer automatic snapshots of the whole server for a small fee: worth enabling.

### Restore a backup

```bash
sudo systemctl stop buildfrance
```

```bash
cd /opt/buildfrance/data && sudo rm -f buildfrance.sqlite-wal buildfrance.sqlite-shm && sudo cp ../backups/buildfrance-2026-11-08_023000.sqlite buildfrance.sqlite && sudo chown buildfrance:buildfrance buildfrance.sqlite
```

```bash
sudo systemctl start buildfrance
```

---

## Updating the application

```bash
cd /opt/buildfrance && sudo -u buildfrance node scripts/backup.js
```

```bash
sudo git pull && sudo npm ci --omit=dev
```

```bash
sudo systemctl restart buildfrance
```

The database schema is created and kept up to date automatically when the server starts. Users may need to reload the page (F5) to get the new interface.

---

## Configuration reference

Set in `/opt/buildfrance/.env` (or as environment variables). Restart the service after any change: `sudo systemctl restart buildfrance`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Address Node listens on. Keep `127.0.0.1` behind Nginx. |
| `PORT` | `3000` | Port Node listens on (must match `proxy_pass` in the Nginx config). |
| `DATA_DIR` | `./data` | Folder of the SQLite database. |
| `BACKUP_DIR` | `./backups` | Folder for `scripts/backup.js`. |
| `BACKUP_KEEP` | `30` | Number of backup files kept. |
| `TRUST_PROXY` | `1` | Number of proxies in front of Node (used to read the real client IP for login rate limiting). `0` if Node is exposed directly. |
| `COOKIE_SECURE` | `true` in production | Login cookie sent over HTTPS only. `false` only for local HTTP testing. |
| `SESSION_DAYS` | `30` | How long a login stays valid (extended automatically while in use). |
| `SEED_DEMO` | `false` | `true` adds the ADIDAS example quote + invoice when the database is first created. |
| `TZ` | `Europe/Paris` | Time zone used for dates and automatic numbering. |

If you change `DATA_DIR` or `BACKUP_DIR` to another location, also update `ReadWritePaths=` in `/etc/systemd/system/buildfrance.service`, then `sudo systemctl daemon-reload`.

---

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| **502 Bad Gateway** | The Node service is not running: `sudo systemctl status buildfrance` and `sudo journalctl -u buildfrance -n 50`. |
| **Login seems to work but you land on the login page again** | You are on plain `http://` with `COOKIE_SECURE=true`. Use HTTPS (step 8). |
| **"Trop de tentatives"** | 10 failed logins from that IP: wait 15 minutes, or `sudo systemctl restart buildfrance` to reset the counter. |
| **`SQLITE_CANTOPEN` / `attempt to write a readonly database`** | Ownership of `data/`: `sudo chown -R buildfrance:buildfrance /opt/buildfrance/data`. |
| **`npm ci` fails on `better-sqlite3`** | Install build tools: `sudo apt install -y build-essential python3`, then rerun. Check `node -v` ≥ 22. |
| **Import fails with "Données trop volumineuses"** | Raise `client_max_body_size` in the Nginx config (default 20m). |
| **"Le numéro … est déjà utilisé"** | A number you typed by hand belongs to another document of the same type: choose another one, or click *Recalculer selon la date*. |
| **PDF button falls back to printing** | The browser could not load the PDF library from the CDN (no internet / blocked). Use *Imprimer → Enregistrer au format PDF*. |

Live logs:

```bash
sudo journalctl -u buildfrance -f
```

---

## Security notes

- Every page and API call except the login page requires a valid session. Sessions are random 256-bit tokens, stored hashed in the database, sent in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie.
- Passwords are hashed with scrypt (salted). Minimum 8 characters.
- API writes must be JSON requests, which blocks cross-site form submissions (CSRF).
- Node only listens on `127.0.0.1`; the outside world only reaches Nginx (ports 80/443).
- The service runs as an unprivileged `buildfrance` user with a read-only view of the system (`ProtectSystem=strict`), except for `data/` and `backups/`.
- Two people editing **the same document at the same moment**: the last save wins. Editing different documents at the same time is fine. Other users' changes appear when you change page or come back to the tab.
- Keep the server updated (`sudo apt upgrade`), and consider `sudo apt install unattended-upgrades fail2ban`.

---

## API reference

All endpoints are under `/api`, exchange JSON, and require the session cookie except `health` and `login`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | `{"ok":true}`: for uptime monitoring |
| POST | `/api/login` | `{username, password}` → sets the session cookie |
| POST | `/api/logout` | Ends the session |
| GET | `/api/me` | Logged-in user |
| POST | `/api/password` | `{current, next}`: change own password |
| GET | `/api/state` | Everything: `{revision, settings, clients, documents, user}` |
| GET | `/api/revision` | Data version number (changes on every write) |
| PUT | `/api/settings` | Save settings |
| PUT / DELETE | `/api/clients/:id` | Create-or-update / delete a client |
| PUT / DELETE | `/api/documents/:id` | Create-or-update / delete a quote or invoice (the server fixes duplicate numbers) |
| GET | `/api/export` | Download a full JSON backup |
| POST | `/api/import` | Replace all data with a JSON backup |
