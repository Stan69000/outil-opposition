const express = require("express");
const { db } = require("../db");
const Anthropic = require("@anthropic-ai/sdk");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Date limite réponse = 1 mois après envoi (L2121-26 CGCT)
function dateLimiteReponse(dateEnvoi) {
  if (!dateEnvoi) return "";
  const d = new Date(dateEnvoi);
  if (isNaN(d)) return "";
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function parseQuestion(row) {
  if (!row) return null;
  const today = new Date().toISOString().slice(0, 10);
  const joursReponse = row.date_limite_reponse
    ? Math.ceil((new Date(row.date_limite_reponse) - new Date(today)) / 86400000)
    : null;
  return { ...row, jours_limite: joursReponse };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM questions_ecrites ORDER BY created_at DESC").all();
  res.json(rows.map(parseQuestion));
});

router.post("/", (req, res) => {
  const { objet, texte, destinataire = "maire", date_envoi = "", base_legale = "CGCT L2121-26" } = req.body;
  if (!objet || !texte) return res.status(400).json({ error: "objet et texte requis" });

  const date_limite = date_envoi ? dateLimiteReponse(date_envoi) : "";
  const statut = date_envoi ? "envoyée" : "brouillon";

  const result = db.prepare(`
    INSERT INTO questions_ecrites (objet, texte, destinataire, date_envoi, date_limite_reponse, statut, base_legale)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(objet, texte, destinataire, date_envoi, date_limite, statut, base_legale);

  res.json(parseQuestion(db.prepare("SELECT * FROM questions_ecrites WHERE id = ?").get(result.lastInsertRowid)));
});

router.put("/:id", (req, res) => {
  const { objet, texte, destinataire, date_envoi, statut, reponse, date_reponse } = req.body;
  const cur = db.prepare("SELECT * FROM questions_ecrites WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "question introuvable" });

  const newDateLimite = date_envoi ? dateLimiteReponse(date_envoi) : cur.date_limite_reponse;

  db.prepare(`
    UPDATE questions_ecrites SET
      objet               = COALESCE(?, objet),
      texte               = COALESCE(?, texte),
      destinataire        = COALESCE(?, destinataire),
      date_envoi          = COALESCE(?, date_envoi),
      date_limite_reponse = ?,
      statut              = COALESCE(?, statut),
      reponse             = COALESCE(?, reponse),
      date_reponse        = COALESCE(?, date_reponse)
    WHERE id = ?
  `).run(objet ?? null, texte ?? null, destinataire ?? null, date_envoi ?? null,
    newDateLimite, statut ?? null, reponse ?? null, date_reponse ?? null, req.params.id);

  res.json(parseQuestion(db.prepare("SELECT * FROM questions_ecrites WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM questions_ecrites WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Générer une question écrite avec IA
router.post("/generate", async (req, res) => {
  const { sujet, contexte = "" } = req.body;
  if (!sujet) return res.status(400).json({ error: "sujet requis" });

  const pvs = db.prepare("SELECT date, objet, points, anomalies FROM pvs ORDER BY date DESC LIMIT 10").all();

  const msg = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `Tu es conseiller municipal d'opposition à Fleurieux-sur-l'Arbresle (69210, ~2000 hab).
Rédige une question écrite formelle au Maire sur le sujet suivant : "${sujet}"
${contexte ? `Contexte : ${contexte}` : ""}

Historique séances récentes :
${pvs.map(p => `${p.date} — ${p.objet}`).join("\n")}

Format attendu :
- Objet (une ligne concise)
- Corps de la question (3-4 paragraphes : contexte, question précise, base légale, délai de réponse attendu)
- Ton formel et factuel
- Base légale : CGCT L2121-26 (droit des conseillers à l'information)

Retourne UNIQUEMENT ce JSON :
{"objet":"...","texte":"...","base_legale":"CGCT L2121-26"}`,
    }],
  });

  trackUsage("questions/generate", "claude-opus-4-5", msg.usage);
  const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
  res.json(JSON.parse(raw));
});

// Générer une lettre de relance
router.post("/:id/relance", async (req, res) => {
  const q = db.prepare("SELECT * FROM questions_ecrites WHERE id = ?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "introuvable" });

  const msg = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: `Rédige une lettre de relance formelle pour une question écrite sans réponse.
Question initiale : "${q.objet}"
Date d'envoi : ${q.date_envoi}
Date limite dépassée : ${q.date_limite_reponse}
Destinataire : ${q.destinataire}

Ton ferme mais respectueux. Mentionne le délai légal CGCT L2121-26, les relances déjà effectuées si applicable.
Retourne le texte de la relance directement (pas de JSON).`,
    }],
  });

  trackUsage("questions/relance", "claude-opus-4-5", msg.usage);
  const relanceText = msg.content[0].text;
  db.prepare("UPDATE questions_ecrites SET relances = relances + 1, statut = 'relance' WHERE id = ?").run(q.id);
  res.json({ texte: relanceText });
});

module.exports = router;
