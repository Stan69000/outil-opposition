# Outil Opposition Municipale — Fleurieux-sur-l'Arbresle

Outil de veille et d'action pour les conseillers municipaux d'opposition.

Commune : **Fleurieux-sur-l'Arbresle** (69210) · ~2000 habitants · Ain / Métropole de Lyon

---

## Fonctionnalités

### En séance
- **Séance live** — interface tablette pour suivre les points en direct : votes, chrono, quorum, signalement d'anomalies en un clic, export automatique en PV

### Suivi légal
- **Procès-verbaux** — import automatique depuis le site mairie (2020-2026), analyse IA de chaque délibération, countdown délai de recours (CGCT / CJA)
- **Failles & irrégularités** — tracker des manquements légaux avec gravité, statut et conseil d'action juridique
- **Questions écrites** — rédaction IA, suivi des délais légaux de réponse (L2121-26), lettres de relance automatiques
- **CADA** — demandes d'accès aux documents administratifs, génération de lettres conformes, suivi des statuts

### Veille & recherche
- **Légifrance** — recherche de textes (API PISTE + fallback IA), surveillance de textes applicables aux communes
- **Jurisprudence** — recherche TA Lyon / CAA Lyon / Conseil d'État, enrichie IA
- **Agenda & prédiction** — Claude prédit l'agenda de la prochaine séance à partir de l'historique + questions à poser par point

### Analyses IA (Claude)
- Bilan légalité · Questions séance · Rapport citoyen · Analyse PLU/ZAN · Audit budget
- **Tendances 2020-2026** — détection de patterns récurrents dans les délibérations
- **Benchmark OFGL** — comparaison des finances de Fleurieux avec communes similaires du Rhône (data.gouv.fr)
- **Fiche séance imprimable** — préparation avant séance, imprimable
- **Rapport citoyen** — rapport diffusable aux habitants, export PDF

### Infrastructure
- **Sync automatique** — cron lundi 8h, scraping du site mairie, import des nouvelles délibérations
- **Email alerts** — nodemailer, alerte sur nouvelles séances et délais urgents
- **PWA** — installable sur mobile/tablette, notifications push sur nouvelles délibérations
- **Thème dark/light** — persisté en localStorage
- **Admin — coûts API** — tracking temps réel de chaque appel Anthropic (tokens in/out, coût USD) par route et par modèle, historique 30 jours

---

## Stack

| Couche | Tech |
|--------|------|
| Backend | Node.js 24, Express, node:sqlite (sans compilation native) |
| IA | Anthropic Claude (claude-opus-4-5) |
| Scraping | Axios + Cheerio |
| PDF | pdf-parse |
| Cron | node-cron |
| Email | nodemailer |
| Push | web-push (VAPID) |
| Frontend | React 18, Vite 5 |
| PWA | Service Worker, Web Push API |

---

## Structure

```
outil-opposition/
├── server/                  # API Express
│   ├── routes/
│   │   ├── pvs.js           # Procès-verbaux CRUD
│   │   ├── failles.js       # Irrégularités CRUD
│   │   ├── lois.js          # Textes surveillés CRUD
│   │   ├── mairie.js        # Scraping site mairie
│   │   ├── legifrance.js    # API PISTE Légifrance
│   │   ├── jurisprudence.js # Jurisprudence (scraping + IA)
│   │   ├── pdf.js           # Analyse PDF IA (SSE)
│   │   ├── analyses.js      # Patterns, budget, séance prep, rapport
│   │   ├── live.js          # Séance live CRUD
│   │   ├── questions.js     # Questions écrites
│   │   ├── cada.js          # Demandes CADA
│   │   ├── agenda.js        # Prédiction agenda IA
│   │   ├── benchmark.js     # OFGL data.gouv.fr
│   │   ├── push.js          # Web Push notifications
│   │   ├── config.js        # Configuration commune via interface admin
│   │   └── ai.js            # Endpoint IA générique
│   │   └── admin.js         # Stats coûts API (/api/admin/usage)
│   ├── services/
│   │   ├── ai-client.js     # Client Anthropic centralisé (clé, modèle, contexte commune)
│   │   ├── ai-tracker.js    # Tracking usage tokens + coût USD par appel IA
│   │   ├── crypto.js        # Chiffrement AES-256 pour clés sensibles en DB
│   │   ├── pdf-analyzer.js  # Extraction + analyse PDF
│   │   ├── cron.js          # Synchro automatique lundi 8h
│   │   └── mailer.js        # Alertes email
│   ├── db.js                # SQLite (node:sqlite)
│   ├── index.js             # Point d'entrée Express
│   └── .env.example         # Variables à renseigner
└── client/                  # React + Vite
    ├── src/
    │   ├── App.jsx           # Application complète (thème, composants, onglets)
    │   └── api.js            # Wrapper fetch → API
    └── public/
        ├── manifest.json     # PWA manifest
        └── sw.js             # Service Worker (cache + push)
```

---

## Installation

```bash
# Cloner
git clone https://github.com/Stan69000/outil-opposition.git
cd outil-opposition

# Backend
cd server
npm install
cp .env.example .env
# Remplir .env (ANTHROPIC_API_KEY, PISTE credentials, SMTP, VAPID)
node index.js

# Frontend (dev)
cd ../client
npm install
npm run dev
# → http://localhost:5173
```

---

## Configuration `.env`

```env
ANTHROPIC_API_KEY=sk-ant-...

# API PISTE Légifrance (beta.piste.gouv.fr)
PISTE_OAUTH_CLIENT_ID=...
PISTE_OAUTH_CLIENT_SECRET=...

# Email alertes (optionnel)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
ALERT_EMAIL=

# PWA Push (généré une fois : npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

APP_HOST=
```

---

## Déploiement VPS

```bash
# Sur le VPS (Ubuntu, Nginx, PM2)
bash deploy.sh
```

Le script `deploy.sh` : build client, copie les fichiers, redémarre PM2.
Nginx sert le client statique et proxifie `/api` vers le port 3001.

---

## Données

- Base SQLite locale (`server/fleurieux.db`)
- 62 séances importées automatiquement (2020-2026)
- Aucune donnée personnelle ni confidentielle

---

## Licence

Usage privé — opposition municipale Fleurieux-sur-l'Arbresle.
