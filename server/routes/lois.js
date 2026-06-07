const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM lois ORDER BY created_at DESC").all());
});

router.post("/", (req, res) => {
  const { id_lf = "", titre, date, impact = "Moyenne", domaine = "", statut = "À surveiller", resume = "", action = "", url = "" } = req.body;
  if (!titre) return res.status(400).json({ error: "titre requis" });

  if (id_lf && db.prepare("SELECT id FROM lois WHERE id_lf = ?").get(id_lf)) {
    return res.status(409).json({ error: "Texte déjà surveillé" });
  }

  const result = db.prepare(`
    INSERT INTO lois (id_lf, titre, date, impact, domaine, statut, resume, action, url)
    VALUES (@id_lf, @titre, @date, @impact, @domaine, @statut, @resume, @action, @url)
  `).run({ id_lf, titre, date: date || new Date().toISOString().slice(0, 10), impact, domaine, statut, resume, action, url });

  res.status(201).json(db.prepare("SELECT * FROM lois WHERE id = ?").get(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const { id } = req.params;
  const existing = db.prepare("SELECT * FROM lois WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Loi introuvable" });

  const fields = ["statut", "impact", "titre", "resume", "action", "url", "domaine"];
  const updates = {};
  for (const f of fields) updates[f] = req.body[f] ?? existing[f];

  db.prepare(`
    UPDATE lois SET statut=@statut, impact=@impact, titre=@titre, resume=@resume,
      action=@action, url=@url, domaine=@domaine
    WHERE id=@id
  `).run({ ...updates, id });

  res.json(db.prepare("SELECT * FROM lois WHERE id = ?").get(id));
});

router.delete("/:id", (req, res) => {
  const result = db.prepare("DELETE FROM lois WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Loi introuvable" });
  res.json({ ok: true });
});

module.exports = router;
