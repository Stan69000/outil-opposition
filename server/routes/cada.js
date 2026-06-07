const express = require("express");
const { db } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();

// Délai légal CADA : 1 mois pour réponse (loi 1978, art. 17)
function dateLimiteCada(dateDemande) {
  if (!dateDemande) return "";
  const d = new Date(dateDemande);
  if (isNaN(d)) return "";
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function parseCada(row) {
  if (!row) return null;
  const today = new Date().toISOString().slice(0, 10);
  const joursLimite = row.date_limite
    ? Math.ceil((new Date(row.date_limite) - new Date(today)) / 86400000)
    : null;
  return { ...row, jours_limite: joursLimite };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM cada_requests ORDER BY created_at DESC").all();
  res.json(rows.map(parseCada));
});

router.post("/", (req, res) => {
  const { document_demande, destinataire = "mairie", motif = "", date_demande } = req.body;
  if (!document_demande) return res.status(400).json({ error: "document_demande requis" });

  const date = date_demande || new Date().toISOString().slice(0, 10);
  const date_limite = dateLimiteCada(date);

  const result = db.prepare(`
    INSERT INTO cada_requests (date_demande, date_limite, destinataire, document_demande, motif, statut)
    VALUES (?, ?, ?, ?, ?, 'envoyée')
  `).run(date, date_limite, destinataire, document_demande, motif);

  res.json(parseCada(db.prepare("SELECT * FROM cada_requests WHERE id = ?").get(result.lastInsertRowid)));
});

router.put("/:id", (req, res) => {
  const { statut, reponse, date_reponse, lien_document } = req.body;
  const cur = db.prepare("SELECT * FROM cada_requests WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "introuvable" });

  db.prepare(`
    UPDATE cada_requests SET
      statut       = COALESCE(?, statut),
      reponse      = COALESCE(?, reponse),
      date_reponse = COALESCE(?, date_reponse),
      lien_document = COALESCE(?, lien_document)
    WHERE id = ?
  `).run(statut ?? null, reponse ?? null, date_reponse ?? null, lien_document ?? null, req.params.id);

  res.json(parseCada(db.prepare("SELECT * FROM cada_requests WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM cada_requests WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Générer une lettre CADA avec IA
router.post("/generate", async (req, res) => {
  const { document_demande, motif = "" } = req.body;
  if (!document_demande) return res.status(400).json({ error: "document_demande requis" });

  const client = getAIClient();
  const msg = await client.messages.create({
    model: getAIModel(),
    max_tokens: 800,
    messages: [{
      role: "user",
      content: `Rédige une lettre de demande d'accès à un document administratif (loi du 17/07/1978, désormais code des relations entre le public et l'administration, CRPA art. L311-1 et suivants).

Expéditeur : Conseiller municipal d'opposition, commune de ${communeLabel()}
Destinataire : Mairie / CADA si recours
Document demandé : ${document_demande}
Motif / contexte : ${motif || "exercice du mandat de conseiller municipal d'opposition"}

La lettre doit :
- Citer précisément les textes (CRPA L311-1, L311-2, L311-9)
- Préciser le délai légal de réponse (1 mois, tacite = refus)
- Indiquer qu'en cas de silence/refus, saisine de la CADA sera effectuée
- Être formelle et concise

Retourne le texte de la lettre directement (pas de JSON, pas de markdown).`,
    }],
  });

  trackUsage("cada/generate", msg.model, msg.usage);
  res.json({ texte: msg.content[0].text, document_demande, date_demande: new Date().toISOString().slice(0, 10) });
});

module.exports = router;
