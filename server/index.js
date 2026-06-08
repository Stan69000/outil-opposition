require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { db } = require("./db");
const auth = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === "production";

// ── Gardes de démarrage (fail-closed en production) ──────────────────────────────
if (IS_PROD) {
  const missing = [];
  if (!process.env.APP_AUTH_TOKEN) missing.push("APP_AUTH_TOKEN (authentification de l'API)");
  if (!process.env.ENCRYPTION_KEY) missing.push("ENCRYPTION_KEY (chiffrement des secrets en base)");
  if (missing.length) {
    console.error("[FATAL] Variables d'environnement obligatoires manquantes en production :");
    for (const m of missing) console.error("  - " + m);
    console.error("Définissez-les dans server/.env puis redémarrez.");
    process.exit(1);
  }
}

// Derrière Nginx : nécessaire pour que express-rate-limit lise la vraie IP cliente.
app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));

// En-têtes de sécurité de base (sans dépendance externe).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

app.use(cors({
  origin: IS_PROD
    ? [`http://${process.env.APP_HOST || "179.237.66.21"}`, `https://${process.env.APP_HOST || "179.237.66.21"}`]
    : "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "x-app-token"],
}));

// Toute l'API est protégée par token (voir middleware/auth.js).
app.use("/api", auth);

// Limiteur générique pour les appels IA.
const aiLimiter = rateLimit({
  windowMs: 60_000, max: 20,
  message: { error: "Trop de requêtes IA, réessayez dans une minute." },
});

// Plafond de coût IA quotidien (lecture de ai_usage_log).
function dailyCostGuard(req, res, next) {
  try {
    const cap = parseFloat(process.env.AI_DAILY_USD_CAP || "5");
    if (cap > 0) {
      const row = db.prepare(
        "SELECT SUM(cost_usd) c FROM ai_usage_log WHERE substr(called_at,1,10) = date('now')"
      ).get();
      if ((row?.c || 0) >= cap) {
        return res.status(429).json({
          error: `Plafond de coût IA quotidien atteint (${cap}$). Réessayez demain ou augmentez AI_DAILY_USD_CAP.`,
        });
      }
    }
  } catch (_) { /* en cas d'erreur de lecture, on laisse passer */ }
  next();
}

const aiGuards = [aiLimiter, dailyCostGuard];

// Configuration
app.use("/api/config",       require("./routes/config"));

// Routes CRUD / scraping
app.use("/api/pvs",          require("./routes/pvs"));
app.use("/api/failles",      require("./routes/failles"));
app.use("/api/lois",         require("./routes/lois"));
app.use("/api/mairie",       require("./routes/mairie"));
app.use("/api/legifrance",   require("./routes/legifrance")); // API PISTE, pas d'IA

// Routes IA (rate-limit + plafond coût)
app.use("/api/ai",           aiGuards, require("./routes/ai"));
app.use("/api/pdf",          aiGuards, require("./routes/pdf"));
app.use("/api/analyses",     aiGuards, require("./routes/analyses"));
app.use("/api/jurisprudence",aiGuards, require("./routes/jurisprudence"));
app.use("/api/questions",    aiGuards, require("./routes/questions"));
app.use("/api/cada",         aiGuards, require("./routes/cada"));
app.use("/api/agenda",       aiGuards, require("./routes/agenda"));
app.use("/api/benchmark",    aiGuards, require("./routes/benchmark"));
app.use("/api/deliberations",aiGuards, require("./routes/deliberations"));
app.use("/api/modeles",      aiGuards, require("./routes/modeles"));
app.use("/api/courriers",    aiGuards, require("./routes/courriers"));
app.use("/api/veille",       aiGuards, require("./routes/veille").router);

// Routes sans IA
app.use("/api/live",         require("./routes/live"));
app.use("/api/push",         require("./routes/push"));
app.use("/api/admin",        require("./routes/admin"));
app.use("/api/engagements",  require("./routes/engagements"));
app.use("/api/journal",      require("./routes/journal"));

// Root info en dev
if (!IS_PROD) {
  app.get("/", (_, res) => res.json({ api: "Opposition Fleurieux", dev: "http://localhost:5173" }));
}

// Client statique en production
if (IS_PROD) {
  const dist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(dist));
  app.get("*", (_, res) => res.sendFile(path.join(dist, "index.html")));
}

// Cron synchro automatique
const { startCron, registerSyncFn } = require("./services/cron");
const mairieRoute = require("./routes/mairie");

// Exposer la fonction de sync au cron (sans passer par HTTP)
if (mairieRoute.syncFn) registerSyncFn(mairieRoute.syncFn);
startCron();

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT} (${process.env.NODE_ENV || "development"})`);
});
