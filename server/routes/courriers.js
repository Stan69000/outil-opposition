const express = require("express");
const { db } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();

const DELAIS = {
  "Question écrite":  30,
  "Demande CADA":     30,
  "Recours gracieux": 60,
  "Courrier Préfet":  30,
  "Autre":            30,
};

function dateLimite(dateEnvoi, type) {
  if (!dateEnvoi) return "";
  const d = new Date(dateEnvoi);
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + (DELAIS[type] || 30));
  return d.toISOString().slice(0, 10);
}

function parseCourrier(row) {
  if (!row) return null;
  const today = new Date().toISOString().slice(0, 10);
  const joursRestants = row.date_reponse_limite
    ? Math.ceil((new Date(row.date_reponse_limite) - new Date(today)) / 86400000)
    : null;
  return { ...row, jours_limite: joursRestants };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM courriers ORDER BY created_at DESC").all();
  res.json(rows.map(parseCourrier));
});

router.post("/", (req, res) => {
  const { type = "Question écrite", destinataire = "Maire", objet, contenu, date_envoi = "", notes = "" } = req.body;
  if (!objet || !contenu) return res.status(400).json({ error: "objet et contenu requis" });

  const statut = date_envoi ? "envoyé" : "brouillon";
  const limite = date_envoi ? dateLimite(date_envoi, type) : "";

  const result = db.prepare(`
    INSERT INTO courriers (type, destinataire, objet, contenu, date_envoi, date_reponse_limite, statut, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(type, destinataire, objet, contenu, date_envoi, limite, statut, notes);

  res.json(parseCourrier(db.prepare("SELECT * FROM courriers WHERE id = ?").get(result.lastInsertRowid)));
});

router.put("/:id", (req, res) => {
  const { type, destinataire, objet, contenu, date_envoi, statut, reponse, date_reponse, notes } = req.body;
  const cur = db.prepare("SELECT * FROM courriers WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "courrier introuvable" });

  const newType = type ?? cur.type;
  const newDateEnvoi = date_envoi ?? cur.date_envoi;
  const newLimite = newDateEnvoi ? dateLimite(newDateEnvoi, newType) : cur.date_reponse_limite;

  db.prepare(`
    UPDATE courriers SET
      type                = COALESCE(?, type),
      destinataire        = COALESCE(?, destinataire),
      objet               = COALESCE(?, objet),
      contenu             = COALESCE(?, contenu),
      date_envoi          = COALESCE(?, date_envoi),
      date_reponse_limite = ?,
      statut              = COALESCE(?, statut),
      reponse             = COALESCE(?, reponse),
      date_reponse        = COALESCE(?, date_reponse),
      notes               = COALESCE(?, notes)
    WHERE id = ?
  `).run(
    type ?? null, destinataire ?? null, objet ?? null, contenu ?? null,
    date_envoi ?? null, newLimite, statut ?? null,
    reponse ?? null, date_reponse ?? null, notes ?? null, req.params.id
  );

  res.json(parseCourrier(db.prepare("SELECT * FROM courriers WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM courriers WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Génération IA du contenu du courrier
router.post("/generate", async (req, res) => {
  const { type, destinataire, sujet, contexte = "" } = req.body;
  if (!type || !sujet) return res.status(400).json({ error: "type et sujet requis" });

  const pvs = db.prepare("SELECT date, objet, anomalies FROM pvs ORDER BY date DESC LIMIT 5").all();
  const failles = db.prepare("SELECT titre, cgct, description FROM failles WHERE statut != 'Résolu' LIMIT 5").all();

  const client = getAIClient();
  const msg = await client.messages.create({
    model: getAIModel(),
    max_tokens: 1200,
    messages: [{
      role: "user",
      content: `Tu es conseiller municipal d'opposition à ${communeLabel()}.
Rédige un(e) "${type}" formel(le) destiné(e) à : ${destinataire}
Sujet : "${sujet}"
${contexte ? `Contexte : ${contexte}` : ""}

Contexte municipal :
${pvs.map(p => `- Séance ${p.date} : ${p.objet}`).join("\n")}
Irrégularités actives : ${failles.map(f => f.titre).join(", ")}

Format attendu : objet précis + corps structuré (contexte, demande, bases légales, délai).
Retourne UNIQUEMENT ce JSON :
{"objet":"...","contenu":"..."}`,
    }],
  });

  trackUsage("courriers/generate", msg.model, msg.usage);
  const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
  res.json(JSON.parse(raw));
});

// Marquer comme envoyé
router.post("/:id/envoyer", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const cur = db.prepare("SELECT * FROM courriers WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "introuvable" });
  const limite = dateLimite(today, cur.type);
  db.prepare("UPDATE courriers SET statut = 'envoyé', date_envoi = ?, date_reponse_limite = ? WHERE id = ?")
    .run(today, limite, req.params.id);
  res.json(parseCourrier(db.prepare("SELECT * FROM courriers WHERE id = ?").get(req.params.id)));
});

module.exports = router;
