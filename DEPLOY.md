# DashView — GitHub se Deploy karna (Free, No Server)

## ✅ Step 1: GitHub Pages ON karo (1 minute)

1. GitHub pe apna repo kholo
2. **Settings** → **Pages** (left sidebar mein)
3. **Source**: `GitHub Actions` select karo
4. Save karo

Ab har baar `main` branch pe push karne pe auto-deploy ho jaayega. ✅

**Tumhara live URL:**
```
https://TUMHARA-USERNAME.github.io/REPO-NAME/
```

---

## ✅ Step 2: Odoo Connect karna (Cloudflare Worker — Free)

> **Production safety:** The Worker/browser flow is intended for low-trust or
> development deployments. Configure exact `ALLOWED_ORIGINS` and
> `ALLOWED_ODOO_HOSTS` values before deploying, and use a dedicated read-only
> Odoo account. Never put an administrator credential in the browser.

### 2a. Worker (backend) — ab built-in hai

Worker `https://dashview.youknowumer-io.workers.dev` par deploy hai aur uska link app ke andar
`js/backend-config.js` mein likha hai (`WORKER_URL`). Settings mein ab **Proxy / Worker URL ki field nahi hai** —
kisi ko kuch paste nahi karna.

- Worker update karna ho to: `wrangler.jsonc` (name = `dashview`) commit karo → Workers Builds redeploy karta hai.
  Ya `npx wrangler deploy`.
- `wrangler.jsonc` mein `ALLOWED_ORIGINS` (exact dashboard origin) aur `ALLOWED_ODOO_HOSTS` (exact Odoo hostname) set rakho.
- Dusra Worker use karna ho to `js/backend-config.js` mein `WORKER_URL` badlo aur site redeploy karo.

### 2b. Dashboard mein configure karo

Dashboard kholo → **Settings** → **Odoo integration**:

| Field | Value |
|-------|-------|
| Odoo URL | `https://yourcompany.odoo.com` |
| Database | `yourcompany-live` |
| Username | `admin@yourcompany.com` |
| API Key | (Odoo → Settings → Users → API Keys) |

**Connect to Odoo** dabao → Live data aane lagega ✅

---

## Kya kya free milta hai

| Service | Cost | Kya karta hai |
|---------|------|---------------|
| GitHub Pages | FREE | Dashboard host karta hai |
| GitHub Actions | FREE | Auto-deploy karta hai |
| Cloudflare Workers | FREE | Odoo proxy (100k req/day) |

**Koi credit card nahi, koi server nahi, koi subscription nahi.**

---

## Local development (optional)

```bash
# Sirf frontend chalana:
# koi bhi file manager mein dashboard.html double-click karo

# Backend + Odoo proxy locally:
cd server
cp .env.example .env    # apni values fill karo
npm install
npm start               # :4000 pe chalta hai
```

---

## Repo structure

```
/
├── .github/
│   └── workflows/
│       └── static.yml         ← Auto-deploy GitHub Actions
├── js/
│   └── odoo-service.js        ← Updated: Cloudflare Worker support
├── server/                    ← Optional Node.js backend
├── cloudflare-worker.js       ← Cloudflare Worker proxy code (legacy single-file copy)
├── js/backend-config.js       ← Worker URL yahan hai (WORKER_URL) — Settings mein nahi
├── dashboard.html             ← Main dashboard
└── DEPLOY.md                  ← Ye file
```

## Worker chal raha hai ya nahi? (quick check)
1. Browser mein apna Worker URL kholo (`https://dashview.youknowumer-io.workers.dev`). Ab ek status JSON dikhta hai (`"ok": true`) aur `problems` mein likha hota hai kya set nahi hai (`ALLOWED_ODOO_HOSTS`, `ALLOWED_ORIGINS`). Pehle yahan "Not found" / "POST only" aata tha, jo dead Worker jaisa lagta tha.
2. Terminal se poora check: `ODOO_URL=... ODOO_DB=... ODOO_USER=... ODOO_KEY=... WORKER_URL=https://workspace.NAAM.workers.dev SITE_ORIGIN=https://youknowumer.github.io node scripts/odoo-check.mjs`
3. DashView mein "Cannot reach the Worker" ab batata hai: Worker down/galat URL hai, ya Worker online hai magar browser ne reply block kiya (ALLOWED_ORIGINS exactly site ka origin hona chahiye, bina path aur bina `/` ke).
4. Crash ho to Cloudflare → Worker → Logs dekho (observability ab on hai).
