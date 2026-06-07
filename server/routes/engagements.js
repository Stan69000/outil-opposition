const express = require("express");
const { db } = require("../db");

const router = express.Router();

const STATUTS_ORDER = { "Promis": 0, "En cours": 1, "En retard": 2, "Tenu": 3, "Abandonné": 4 };

function parseEngagement(row) {
  if (!row) return null;
  const today = new Date().toISOString().slice(0, 10);
  let statut = row.statut;
  if (row.echeance && row.echeance < today && !["Tenu", "Abandonné"].includes(row.statut)) {
    statut = "En retard";
  }
  const joursEcheance = row.echeance
    ? Math.ceil((new Date(row.echeance) - new Date(today)) / 86400000)
    : null;
  return { ...row, statut, jours_echeance: joursEcheance };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM engagements ORDER BY created_at DESC").all();
  res.json(rows.map(parseEngagement));
});

router.post("/", (req, res) => {
  const { titre, auteur = "", categorie = "Autre", date_prise = "", echeance = "", notes = "", preuve_pv_id = 0 } = req.body;
  if (!titre) return res.status(400).json({ error: "titre requis" });

  const result = db.prepare(`
    INSERT INTO engagements (titre, auteur, categorie, date_prise, echeance, statut, preuve_pv_id, notes)
    VALUES (?, ?, ?, ?, ?, 'Promis', ?, ?)
  `).run(titre, auteur, categorie, date_prise, echeance, preuve_pv_id, notes);

  res.json(parseEngagement(db.prepare("SELECT * FROM engagements WHERE id = ?").get(result.lastInsertRowid)));
});

router.put("/:id", (req, res) => {
  const { titre, auteur, categorie, date_prise, echeance, statut, preuve_pv_id, notes } = req.body;
  const cur = db.prepare("SELECT * FROM engagements WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "engagement introuvable" });

  db.prepare(`
    UPDATE engagements SET
      titre        = COALESCE(?, titre),
      auteur       = COALESCE(?, auteur),
      categorie    = COALESCE(?, categorie),
      date_prise   = COALESCE(?, date_prise),
      echeance     = COALESCE(?, echeance),
      statut       = COALESCE(?, statut),
      preuve_pv_id = COALESCE(?, preuve_pv_id),
      notes        = COALESCE(?, notes)
    WHERE id = ?
  `).run(
    titre ?? null, auteur ?? null, categorie ?? null, date_prise ?? null,
    echeance ?? null, statut ?? null, preuve_pv_id ?? null, notes ?? null, req.params.id
  );

  res.json(parseEngagement(db.prepare("SELECT * FROM engagements WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM engagements WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
