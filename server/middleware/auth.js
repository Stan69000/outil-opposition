const crypto = require("crypto");

// Authentification par token partagé (outil mono-équipe).
// Le client envoie le token dans l'en-tête `x-app-token`.
// Si APP_AUTH_TOKEN n'est pas défini, l'API reste ouverte (pratique en dev) —
// mais index.js refuse de démarrer en production sans ce token (fail-closed).
function auth(req, res, next) {
  const expected = process.env.APP_AUTH_TOKEN;
  if (!expected) return next(); // dev : pas de token configuré

  const got = req.get("x-app-token") || "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();

  return res.status(401).json({ error: "Non autorisé" });
}

module.exports = auth;
