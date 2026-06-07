const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM failles ORDER BY date DESC").all();
  res.json(rows);
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
