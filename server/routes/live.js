const express = require("express");
const { db, parsePv } = require("../db");

const router = express.Router();

function parseSeance(row) {
  if (!row) return null;
  const points = db.prepare("SELECT * FROM live_points WHERE seance_id = ? ORDER BY ordre ASC").all(row.id);
  return {
    ...row,
    points: points.map(p => ({ ...p, interventions: JSON.parse(p.interventions || "[]") })),
  };
}

// Liste des séances live (les 20 dernières)
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM seances_live ORDER BY date DESC LIMIT 20").all();
  res.json(rows.map(parseSeance));
});

// Créer une séance live
router.post("/", (req, res) => {
  const { date, presents = 0, quorum = 8, notes = "" } = req.body;
  if (!date) return res.status(400).json({ error: "date requise" });

  const heure = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const result = db.prepare(`
    INSERT INTO seances_live (date, heure_debut, statut, presents, quorum, notes)
    VALUES (?, ?, 'en_cours', ?, ?, ?)
  `).run(date, heure, presents, quorum, notes);

  res.json(parseSeance(db.prepare("SELECT * FROM seances_live WHERE id = ?").get(result.lastInsertRowid)));
});

// Mettre à jour une séance (présents, notes, terminer)
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { presents, notes, statut, heure_fin } = req.body;
  const cur = db.prepare("SELECT * FROM seances_live WHERE id = ?").get(id);
  if (!cur) return res.status(404).json({ error: "séance introuvable" });

  db.prepare(`
    UPDATE seances_live SET
      presents  = COALESCE(?, presents),
      notes     = COALESCE(?, notes),
      statut    = COALESCE(?, statut),
      heure_fin = COALESCE(?, heure_fin)
    WHERE id = ?
  `).run(presents ?? null, notes ?? null, statut ?? null, heure_fin ?? null, id);

  res.json(parseSeance(db.prepare("SELECT * FROM seances_live WHERE id = ?").get(id)));
});

// Ajouter un point à l'ordre du jour
router.post("/:id/points", (req, res) => {
  const { id } = req.params;
  const { titre, ordre } = req.body;
  if (!titre) return res.status(400).json({ error: "titre requis" });

  const maxOrdre = db.prepare("SELECT COALESCE(MAX(ordre),0) as m FROM live_points WHERE seance_id = ?").get(id).m;
  const result = db.prepare(`
    INSERT INTO live_points (seance_id, ordre, titre)
    VALUES (?, ?, ?)
  `).run(id, ordre ?? maxOrdre + 1, titre);

  res.json(db.prepare("SELECT * FROM live_points WHERE id = ?").get(result.lastInsertRowid));
});

// Mettre à jour un point (vote, résultat, anomalie, notes, interventions)
router.put("/:id/points/:pid", (req, res) => {
  const { pid } = req.params;
  const { vote_pour, vote_contre, vote_abstention, resultat, anomalie, anomalie_desc, notes, duree_min, interventions } = req.body;

  db.prepare(`
    UPDATE live_points SET
      vote_pour       = COALESCE(?, vote_pour),
      vote_contre     = COALESCE(?, vote_contre),
      vote_abstention = COALESCE(?, vote_abstention),
      resultat        = COALESCE(?, resultat),
      anomalie        = COALESCE(?, anomalie),
      anomalie_desc   = COALESCE(?, anomalie_desc),
      notes           = COALESCE(?, notes),
      duree_min       = COALESCE(?, duree_min),
      interventions   = COALESCE(?, interventions)
    WHERE id = ?
  `).run(
    vote_pour ?? null, vote_contre ?? null, vote_abstention ?? null,
    resultat ?? null, anomalie ?? null, anomalie_desc ?? null,
    notes ?? null, duree_min ?? null,
    interventions ? JSON.stringify(interventions) : null, pid
  );

  const row = db.prepare("SELECT * FROM live_points WHERE id = ?").get(pid);
  res.json({ ...row, interventions: JSON.parse(row.interventions || "[]") });
});

// Supprimer un point
router.delete("/:id/points/:pid", (req, res) => {
  db.prepare("DELETE FROM live_points WHERE id = ?").run(req.params.pid);
  res.json({ ok: true });
});

// Exporter la séance live en PV dans la table pvs
router.post("/:id/export", (req, res) => {
  const seance = parseSeance(db.prepare("SELECT * FROM seances_live WHERE id = ?").get(req.params.id));
  if (!seance) return res.status(404).json({ error: "séance introuvable" });

  const points = seance.points.map(p => {
    let line = p.titre;
    if (p.resultat) line += ` — ${p.resultat}`;
    if (p.vote_pour || p.vote_contre || p.vote_abstention) {
      line += ` (${p.vote_pour}p / ${p.vote_contre}c / ${p.vote_abstention}a)`;
    }
    return line;
  });

  const anomalies = seance.points
    .filter(p => p.anomalie)
    .map(p => p.anomalie_desc || p.titre);

  const totalPour = seance.points.reduce((s, p) => s + (p.vote_pour || 0), 0);
  const totalContre = seance.points.reduce((s, p) => s + (p.vote_contre || 0), 0);
  const totalAbst = seance.points.reduce((s, p) => s + (p.vote_abstention || 0), 0);

  const existing = db.prepare("SELECT id FROM pvs WHERE date = ? AND source = 'live'").get(seance.date);
  if (existing) {
    db.prepare(`UPDATE pvs SET points = ?, anomalies = ?, notes = ?, votes_pour = ?, votes_contre = ?, votes_abstention = ? WHERE id = ?`)
      .run(JSON.stringify(points), JSON.stringify(anomalies), seance.notes,
        totalPour, totalContre, totalAbst, existing.id);
    db.prepare("UPDATE seances_live SET exported_pv_id = ?, statut = 'terminée' WHERE id = ?")
      .run(existing.id, seance.id);
    return res.json(parsePv(db.prepare("SELECT * FROM pvs WHERE id = ?").get(existing.id)));
  }

  const result = db.prepare(`
    INSERT INTO pvs (date, objet, source, statut, votes_pour, votes_contre, votes_abstention, points, anomalies, notes)
    VALUES (?, ?, 'live', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    seance.date,
    `Conseil municipal du ${seance.date}${seance.heure_debut ? " à " + seance.heure_debut : ""}`,
    anomalies.length > 0 ? "Alerte" : "Analysé",
    totalPour, totalContre, totalAbst,
    JSON.stringify(points), JSON.stringify(anomalies), seance.notes
  );

  db.prepare("UPDATE seances_live SET exported_pv_id = ?, statut = 'terminée' WHERE id = ?")
    .run(result.lastInsertRowid, seance.id);

  res.json(parsePv(db.prepare("SELECT * FROM pvs WHERE id = ?").get(result.lastInsertRowid)));
});

// Supprimer une séance live
router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM live_points WHERE seance_id = ?").run(req.params.id);
  db.prepare("DELETE FROM seances_live WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
