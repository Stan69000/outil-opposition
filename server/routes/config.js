const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const Anthropic = require("@anthropic-ai/sdk");
const { getAllConfig, getConfig, setConfig, CONFIG_DEFAULTS } = require("../db");
const { SENSITIVE_KEYS } = require("../services/crypto");

const router = express.Router();

// Seules ces clés peuvent être écrites via l'API (anti-pollution de la table config).
const ALLOWED_KEYS = new Set([...Object.keys(CONFIG_DEFAULTS), ...SENSITIVE_KEYS]);

function maskSensitive(config) {
  for (const key of SENSITIVE_KEYS) {
    const val = config[key];
    if (val && val.length > 4) {
      config[key + "_masked"] = "••••" + val.slice(-4);
    } else {
      config[key + "_masked"] = val ? "••••" : "";
    }
    delete config[key]; // ne jamais exposer la valeur déchiffrée
  }
  return config;
}

// GET /api/config — toute la config, valeurs sensibles masquées
router.get("/", (req, res) => {
  const config = getAllConfig();
  res.json(maskSensitive(config));
});

// POST /api/config — mise à jour d'une ou plusieurs clés (chiffrement auto des clés sensibles)
router.post("/", (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== "object") {
    return res.status(400).json({ error: "Body JSON requis" });
  }
  const rejected = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key.endsWith("_masked")) continue;
    if (typeof value !== "string") continue;
    if (!ALLOWED_KEYS.has(key)) { rejected.push(key); continue; }
    setConfig(key, value);
  }
  res.json({ ok: true, ...(rejected.length ? { ignored: rejected } : {}) });
});

// ── TESTS DE CONNECTIVITÉ ──────────────────────────────────────────────────────

// POST /api/config/test/ai — vérifie la clé IA avec un appel minimal
router.post("/test/ai", async (req, res) => {
  const t0 = Date.now();
  const apiKey = getConfig("ai_api_key") || process.env.ANTHROPIC_API_KEY || "";
  const model  = getConfig("ai_model") || "claude-opus-4-5";

  if (!apiKey) {
    return res.status(400).json({ ok: false, error: "Aucune clé API configurée" });
  }

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model,
      max_tokens: 5,
      messages: [{ role: "user", content: "ping" }],
    });
    const latency = Date.now() - t0;
    res.json({
      ok: true,
      model,
      latency_ms: latency,
      tokens_used: msg.usage?.input_tokens ?? 0,
      message: `Clé valide — modèle ${model} répond en ${latency}ms`,
    });
  } catch (err) {
    const status = err.status || err.response?.status;
    res.status(200).json({
      ok: false,
      error: status === 401
        ? "Clé API invalide ou révoquée (401)"
        : status === 403
        ? "Accès refusé — vérifier les permissions de la clé (403)"
        : err.message,
    });
  }
});

// POST /api/config/test/legifrance — vérifie les credentials PISTE (OAuth)
router.post("/test/legifrance", async (req, res) => {
  const t0       = Date.now();
  const clientId = getConfig("piste_client_id") || process.env.PISTE_OAUTH_CLIENT_ID || "";
  const secret   = getConfig("piste_client_secret") || process.env.PISTE_OAUTH_CLIENT_SECRET || "";

  if (!clientId || !secret) {
    return res.status(200).json({ ok: false, error: "Client ID ou Secret manquant" });
  }

  try {
    const params = new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     clientId,
      client_secret: secret,
      scope:         "openid",
    });
    const r = await axios.post(
      "https://sandbox-oauth.piste.gouv.fr/api/oauth/token",
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
    );
    const latency = Date.now() - t0;
    res.json({
      ok: true,
      latency_ms: latency,
      token_type: r.data.token_type,
      expires_in: r.data.expires_in,
      message: `OAuth PISTE OK — token valide ${r.data.expires_in}s (${latency}ms)`,
      note: "Le endpoint /search sandbox est instable côté DILA — le fallback IA reste actif.",
    });
  } catch (err) {
    const status = err.response?.status;
    res.status(200).json({
      ok: false,
      error: status === 401
        ? "Credentials invalides (401) — vérifier client_id et client_secret sur beta.piste.gouv.fr"
        : err.message,
    });
  }
});

// POST /api/config/test/smtp — envoie un email de test
router.post("/test/smtp", async (req, res) => {
  const host  = process.env.SMTP_HOST;
  const user  = process.env.SMTP_USER;
  const pass  = process.env.SMTP_PASS;
  const dest  = getConfig("alert_email") || process.env.ALERT_EMAIL;

  if (!host || !user || !dest) {
    return res.status(200).json({
      ok: false,
      error: "SMTP_HOST, SMTP_USER et alert_email requis (renseigner dans .env et Config)",
    });
  }

  try {
    const transport = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: { user, pass },
    });

    await transport.verify();
    await transport.sendMail({
      from: `"Opposition Municipale" <${user}>`,
      to:   dest,
      subject: "[Test] Configuration email — Outil Opposition",
      text:  `Ceci est un email de test envoyé depuis l'outil d'opposition municipale.\n\nSi vous recevez ce message, la configuration SMTP est correcte.\n\nServeur : ${host}`,
    });

    res.json({ ok: true, message: `Email de test envoyé à ${dest}` });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
