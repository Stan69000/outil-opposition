const express = require("express");
const { db } = require("../db");

const router = express.Router();

const TYPES = ["Constat terrain", "Réunion publique", "Contact citoyen", "Observation chantier", "Réunion interne", "Autre"];

function parseEntry(row) {
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags || "[]") };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM journal_terrain ORDER BY date DESC, created_at DESC").all();
  res.json(rows.map(parseEntry));
});

router.post("/", (req, res) => {
  const { date, lieu = "", type = "Constat terrain", contenu, tags = [], lien_pv_id = 0, lien_faille_id = 0 } = req.body;
  if (!date || !contenu) return res.status(400).json({ error: "date et contenu requis" });

  const result = db.prepare(`
    INSERT INTO journal_terrain (date, lieu, type, contenu, tags, lien_pv_id, lien_faille_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(date, lieu, type, contenu, JSON.stringify(tags), lien_pv_id, lien_faille_id);

  res.json(parseEntry(db.prepare("SELECT * FROM journal_terrain WHERE id = ?").get(result.lastInsertRowid)));
});

router.put("/:id", (req, res) => {
  const { date, lieu, type, contenu, tags, lien_pv_id, lien_faille_id } = req.body;
  const cur = db.prepare("SELECT * FROM journal_terrain WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "entrée introuvable" });

  db.prepare(`
    UPDATE journal_terrain SET
      date          = COALESCE(?, date),
      lieu          = COALESCE(?, lieu),
      type          = COALESCE(?, type),
      contenu       = COALESCE(?, contenu),
      tags          = COALESCE(?, tags),
      lien_pv_id    = COALESCE(?, lien_pv_id),
      lien_faille_id= COALESCE(?, lien_faille_id)
    WHERE id = ?
  `).run(
    date ?? null, lieu ?? null, type ?? null, contenu ?? null,
    tags ? JSON.stringify(tags) : null, lien_pv_id ?? null, lien_faille_id ?? null, req.params.id
  );

  res.json(parseEntry(db.prepare("SELECT * FROM journal_terrain WHERE id = ?").get(req.params.id)));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM journal_terrain WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
