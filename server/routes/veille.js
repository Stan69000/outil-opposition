const express = require("express");
const { db } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM veille_alertes ORDER BY date_parution DESC, created_at DESC LIMIT 50").all();
  res.json(rows);
});

router.get("/unread-count", (req, res) => {
  const n = db.prepare("SELECT COUNT(*) as n FROM veille_alertes WHERE lu = 0").get().n;
  res.json({ count: n });
});

router.put("/:id/lu", (req, res) => {
  db.prepare("UPDATE veille_alertes SET lu = 1 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/mark-all-read", (req, res) => {
  db.prepare("UPDATE veille_alertes SET lu = 1").run();
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM veille_alertes WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Lancer une analyse manuelle
router.post("/scan", async (req, res) => {
  try {
    const alertes = await scanVeilleReglementaire();
    res.json({ alertes, count: alertes.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function scanVeilleReglementaire() {
  const client = getAIClient();
  const today = new Date().toISOString().slice(0, 10);

  const msg = await client.messages.create({
    model: getAIModel(),
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `Tu es expert en droit des collectivités territoriales françaises.
Commune concernée : ${communeLabel()} (~2000 habitants, 69).

Liste les 5 textes réglementaires récents (6 derniers mois) les plus importants pour une commune rurale de cette taille :
- Lois, décrets, circulaires DGCL, ordonnances
- Textes impactant : finances locales, urbanisme/ZAN, élus, marchés publics, CGCT

Pour chaque texte, retourne :
- titre court
- source (JO, DGCL, etc.)
- categorie parmi : Finances, Urbanisme, Élus, Marchés publics, Environnement, RH, Autre
- resume (2 phrases max, impact concret pour la commune)
- impact : Haute / Moyenne / Basse
- url si connue (sinon "")
- date_parution (YYYY-MM-DD, si inconnue mets ${today})

Retourne UNIQUEMENT un tableau JSON :
[{"titre":"...","source":"...","categorie":"...","resume":"...","impact":"...","url":"...","date_parution":"..."}]`,
    }],
  });

  trackUsage("veille/scan", msg.model, msg.usage);
  const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
  const items = JSON.parse(raw);

  const ins = db.prepare(`
    INSERT OR IGNORE INTO veille_alertes (titre, source, categorie, resume, impact, url, date_parution)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const inserted = [];
  for (const item of items) {
    const existing = db.prepare("SELECT id FROM veille_alertes WHERE titre = ?").get(item.titre);
    if (!existing) {
      const r = ins.run(item.titre, item.source, item.categorie, item.resume, item.impact, item.url || "", item.date_parution || today);
      inserted.push({ id: r.lastInsertRowid, ...item });
    }
  }

  return inserted;
}

module.exports = { router, scanVeilleReglementaire };
