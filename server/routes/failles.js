const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  // Auto-basculement : failles Ouvert dont le délai de 60j est dépassé → Historique
  db.prepare(`
    UPDATE failles SET statut = 'Historique'
    WHERE statut = 'Ouvert'
    AND date(date, '+60 days') < date('now')
  `).run();

  const rows = db.prepare("SELECT * FROM failles ORDER BY date DESC").all();

  // Ajouter jours_recours sur chaque faille Ouvert/En cours
  const today = new Date().toISOString().slice(0, 10);
  const result = rows.map(f => {
    if (!["Ouvert", "En cours"].includes(f.statut)) return f;
    const deadline = new Date(f.date);
    deadline.setDate(deadline.getDate() + 60);
    const jours = Math.ceil((deadline - new Date(today)) / 86400000);
    return { ...f, jours_recours: jours, recours_deadline: deadline.toISOString().slice(0, 10) };
  });

  res.json(result);
});

router.post("/", (req, res) => {
  const { type, gravite = "Moyenne", statut = "Ouvert", date, cgct = "", titre, description = "", conseil = "" } = req.body;
  if (!titre || !date) return res.status(400).json({ error: "titre et date requis" });

  const result = db.prepare(`
    INSERT INTO failles (type, gravite, statut, date, cgct, titre, description, conseil)
    VALUES (@type, @gravite, @statut, @date, @cgct, @titre, @description, @conseil)
  `).run({ type, gravite, statut, date, cgct, titre, description, conseil });

  res.status(201).json(db.prepare("SELECT * FROM failles WHERE id = ?").get(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const { id } = req.params;
  const existing = db.prepare("SELECT * FROM failles WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Faille introuvable" });

  const fields = ["statut", "gravite", "type", "cgct", "titre", "description", "conseil"];
  const updates = {};
  for (const f of fields) updates[f] = req.body[f] ?? existing[f];

  db.prepare(`
    UPDATE failles SET statut=@statut, gravite=@gravite, type=@type, cgct=@cgct,
      titre=@titre, description=@description, conseil=@conseil
    WHERE id=@id
  `).run({ ...updates, id });

  res.json(db.prepare("SELECT * FROM failles WHERE id = ?").get(id));
});

router.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM failles WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Faille introuvable" });
  res.json({ ok: true });
});

module.exports = router;
