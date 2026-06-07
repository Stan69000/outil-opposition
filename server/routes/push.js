const express = require("express");
const webpush = require("web-push");
const { db } = require("../db");

const router = express.Router();

// VAPID keys (générées une seule fois, stockées dans .env)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.ALERT_EMAIL || "bouchet.stanislas@gmail.com"}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// GET /api/push/vapid-key — clé publique pour le client
router.get("/vapid-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// POST /api/push/subscribe
router.post("/subscribe", (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys) return res.status(400).json({ error: "endpoint et keys requis" });

  try {
    db.prepare(`
      INSERT INTO push_subscriptions (endpoint, keys)
      VALUES (?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys
    `).run(endpoint, JSON.stringify(keys));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/push/subscribe
router.delete("/subscribe", (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  res.json({ ok: true });
});

// POST /api/push/test — envoyer une notif de test
router.post("/test", async (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: "VAPID non configuré. Voir README pour générer les clés." });
  }
  const subs = db.prepare("SELECT * FROM push_subscriptions").all();
  if (!subs.length) return res.status(404).json({ error: "Aucun abonné" });

  const payload = JSON.stringify({
    title: "Opposition Fleurieux",
    body: "Notification de test — système opérationnel",
    icon: "/icon-192.png",
    url: "/",
  });

  const results = await Promise.allSettled(
    subs.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, payload))
  );

  const ok = results.filter(r => r.status === "fulfilled").length;
  const fail = results.filter(r => r.status === "rejected").length;

  // Nettoyer les subscriptions invalides
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected" && results[i].reason?.statusCode === 410) {
      db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(subs[i].endpoint);
    }
  }

  res.json({ sent: ok, failed: fail });
});

// Fonction exportée pour le cron
async function sendPushNotification(title, body, url = "/") {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  const subs = db.prepare("SELECT * FROM push_subscriptions").all();
  if (!subs.length) return;

  const payload = JSON.stringify({ title, body, icon: "/icon-192.png", url });

  await Promise.allSettled(
    subs.map(s =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, payload)
        .catch(err => {
          if (err.statusCode === 410) {
            db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(s.endpoint);
          }
        })
    )
  );
}

router.sendPushNotification = sendPushNotification;

module.exports = router;
