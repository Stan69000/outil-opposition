const express = require("express");
const { db, parsePv } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM pvs ORDER BY date DESC").all();
  res.json(rows.map(parsePv));
});

router.post("/", (req, res) => {
  const { date, objet, source = "manuel", statut, votes = {}, points = [], anomalies = [], notes = "", url_source = "" } = req.body;
  if (!date || !objet) return res.status(400).json({ error: "date et objet requis" });

  const finalStatut = statut || (anomalies.length > 0 ? "Alerte" : "Analysé");
  const stmt = db.prepare(`
    INSERT INTO pvs (date, objet, source, statut, votes_pour, votes_contre, votes_abstention, points, anomalies, notes, url_source)
    VALUES (@date, @objet, @source, @statut, @pour, @contre, @abstention, @points, @anomalies, @notes, @url_source)
  `);
  const result = stmt.run({
    date, objet, source, statut: finalStatut,
    pour: votes.pour || 0, contre: votes.contre || 0, abstention: votes.abstention || 0,
    points: JSON.stringify(points),
    anomalies: JSON.stringify(anomalies),
    notes, url_source,
  });
  const created = db.prepare("SELECT * FROM pvs WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(parsePv(created));
});

router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { statut, notes, votes, points, anomalies } = req.body;
  const existing = db.prepare("SELECT * FROM pvs WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "PV introuvable" });

  db.prepare(`
    UPDATE pvs SET
      statut = @statut,
      notes = @notes,
      votes_pour = @pour,
      votes_contre = @contre,
      votes_abstention = @abstention,
      points = @points,
      anomalies = @anomalies
    WHERE id = @id
  `).run({
    id,
    statut: statut ?? existing.statut,
    notes: notes ?? existing.notes,
    pour: votes?.pour ?? existing.votes_pour,
    contre: votes?.contre ?? existing.votes_contre,
    abstention: votes?.abstention ?? existing.votes_abstention,
    points: points ? JSON.stringify(points) : existing.points,
    anomalies: anomalies ? JSON.stringify(anomalies) : existing.anomalies,
  });
  const updated = db.prepare("SELECT * FROM pvs WHERE id = ?").get(id);
  res.json(parsePv(updated));
});

router.delete("/:id", (req, res) => {
  const { id } = req.params;
  const result = db.prepare("DELETE FROM pvs WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ error: "PV introuvable" });
  res.json({ ok: true });
});

module.exports = router;
