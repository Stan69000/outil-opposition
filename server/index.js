require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? ["http://localhost", `http://${process.env.APP_HOST || "179.237.66.21"}`]
    : "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE"],
}));

const aiLimiter = rateLimit({
  windowMs: 60_000, max: 20,
  message: { error: "Trop de requêtes IA, réessayez dans une minute." },
});

// Configuration
app.use("/api/config",       require("./routes/config"));

// Routes existantes
app.use("/api/ai",           aiLimiter, require("./routes/ai"));
app.use("/api/pvs",          require("./routes/pvs"));
app.use("/api/failles",      require("./routes/failles"));
app.use("/api/lois",         require("./routes/lois"));
app.use("/api/mairie",       require("./routes/mairie"));
app.use("/api/legifrance",   require("./routes/legifrance"));

// Nouvelles routes — fonctionnalités v2
app.use("/api/pdf",          aiLimiter, require("./routes/pdf"));
app.use("/api/analyses",     aiLimiter, require("./routes/analyses"));
app.use("/api/jurisprudence",require("./routes/jurisprudence"));
app.use("/api/live",         require("./routes/live"));
app.use("/api/questions",    aiLimiter, require("./routes/questions"));
app.use("/api/cada",         aiLimiter, require("./routes/cada"));
app.use("/api/agenda",       aiLimiter, require("./routes/agenda"));
app.use("/api/benchmark",    require("./routes/benchmark"));
app.use("/api/push",         require("./routes/push"));
app.use("/api/admin",        require("./routes/admin"));

// Fonctionnalités v3
app.use("/api/modeles",      aiLimiter, require("./routes/modeles"));
app.use("/api/courriers",    aiLimiter, require("./routes/courriers"));
app.use("/api/engagements",  require("./routes/engagements"));
app.use("/api/journal",      require("./routes/journal"));
app.use("/api/veille",       aiLimiter, require("./routes/veille").router);

// Root info en dev
if (process.env.NODE_ENV !== "production") {
  app.get("/", (_, res) => res.json({ api: "Opposition Fleurieux", dev: "http://localhost:5173" }));
}

// Client statique en production
if (process.env.NODE_ENV === "production") {
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
