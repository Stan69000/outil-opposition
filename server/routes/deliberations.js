const express = require("express");
const axios = require("axios");
const { db } = require("../db");
const { extractAndAnalyze } = require("../services/pdf-analyzer");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();

function parseDelib(row) {
  if (!row) return null;
  return {
    ...row,
    anomalies: JSON.parse(row.anomalies || "[]"),
    points: JSON.parse(row.points || "[]"),
    is_urba: !!row.is_urba,
  };
}

async function geocodeAdresse(adresse, commune = "Fleurieux-sur-l'Arbresle") {
  try {
    const q = encodeURIComponent(`${adresse} ${commune}`);
    const { data } = await axios.get(
      `https://api-adresse.data.gouv.fr/search/?q=${q}&limit=1`,
      { timeout: 5000 }
    );
    if (data.features?.length > 0) {
      const [lng, lat] = data.features[0].geometry.coordinates;
      const label = data.features[0].properties.label;
      return { lat, lng, adresse: label };
    }
  } catch (_) {}
  return null;
}

// GET /api/deliberations — toutes les délibérations
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM deliberations ORDER BY created_at DESC").all();
  res.json(rows.map(parseDelib));
});

// GET /api/deliberations/seance/:pvId — délibérations d'une séance
router.get("/seance/:pvId", (req, res) => {
  const rows = db.prepare("SELECT * FROM deliberations WHERE seance_id = ? ORDER BY numero ASC").all(req.params.pvId);
  res.json(rows.map(parseDelib));
});

// PUT /api/deliberations/:id — mise à jour (geo, statut…)
router.put("/:id", (req, res) => {
  const { geo, statut, notes, adresse } = req.body;
  const existing = db.prepare("SELECT * FROM deliberations WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Délibération introuvable" });

  db.prepare(`
    UPDATE deliberations SET
      geo = @geo, statut = @statut, notes = @notes, adresse = @adresse
    WHERE id = @id
  `).run({
    id: req.params.id,
    geo: geo ?? existing.geo,
    statut: statut ?? existing.statut,
    notes: notes ?? existing.notes,
    adresse: adresse ?? existing.adresse,
  });

  res.json(parseDelib(db.prepare("SELECT * FROM deliberations WHERE id = ?").get(req.params.id)));
});

// POST /api/deliberations/fill-missing — extrait le texte des délibérations sans pdf_text (SSE)
router.post("/fill-missing", async (req, res) => {
  const missing = db.prepare(
    "SELECT * FROM deliberations WHERE (pdf_text IS NULL OR length(pdf_text) < 100) AND pdf_url != '' ORDER BY id ASC"
  ).all();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "total", total: missing.length });

  let done = 0, errors = 0;

  for (const delib of missing) {
    send({ type: "progress", current: done + 1, total: missing.length, nom: delib.pdf_nom });
    try {
      const { text, analysis } = await extractAndAnalyze(delib.pdf_url, delib.pdf_nom);
      if (analysis.error) {
        errors++;
        send({ type: "skip", nom: delib.pdf_nom, reason: analysis.error });
        continue;
      }

      let geo = delib.geo || "";
      let adresse = analysis.adresse_concernee || delib.adresse || "";
      if (analysis.is_urbanisme && adresse && !geo) {
        const coords = await geocodeAdresse(adresse);
        if (coords) { geo = JSON.stringify(coords); adresse = coords.adresse; }
      }

      db.prepare(`
        UPDATE deliberations SET
          pdf_text = @pdf_text, statut = @statut,
          votes_pour = @pour, votes_contre = @contre, votes_abstention = @abstention,
          anomalies = @anomalies, points = @points,
          risque_juridique = @risque, action_opposition = @action,
          is_urba = @is_urba, adresse = @adresse, geo = @geo
        WHERE id = @id
      `).run({
        id: delib.id,
        pdf_text: text.slice(0, 15000),
        statut: (analysis.anomalies?.length > 0) ? "Alerte" : "Analysé",
        pour: analysis.votes_pour ?? delib.votes_pour ?? 0,
        contre: analysis.votes_contre ?? delib.votes_contre ?? 0,
        abstention: analysis.votes_abstention ?? delib.votes_abstention ?? 0,
        anomalies: JSON.stringify(analysis.anomalies || []),
        points: JSON.stringify(analysis.points_cles || []),
        risque: analysis.risque_juridique || "Aucun",
        action: analysis.action_opposition || "",
        is_urba: analysis.is_urbanisme ? 1 : 0,
        adresse,
        geo,
      });

      done++;
      send({ type: "result", nom: delib.pdf_nom, id: delib.id });
    } catch (err) {
      errors++;
      send({ type: "skip", nom: delib.pdf_nom, reason: err.message });
    }
  }

  send({ type: "done", done, errors });
  res.end();
});

// POST /api/deliberations/extract/:pvId — extrait les délibérations d'une séance (SSE)
router.post("/extract/:pvId", async (req, res) => {
  const pv = db.prepare("SELECT * FROM pvs WHERE id = ?").get(req.params.pvId);
  if (!pv) return res.status(404).json({ error: "Séance introuvable" });

  const pdfs = JSON.parse(pv.pdfs || "[]");
  if (pdfs.length === 0) return res.status(400).json({ error: "Aucun PDF dans cette séance" });

  // Supprimer les délibérations existantes de cette séance pour ré-extraire
  db.prepare("DELETE FROM deliberations WHERE seance_id = ?").run(pv.id);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const created = [];
  let done = 0;
  let errors = 0;

  for (const pdf of pdfs) {
    send({ type: "progress", current: done + 1, total: pdfs.length, nom: pdf.nom });

    try {
      const { text, analysis } = await extractAndAnalyze(pdf.url, pdf.nom);
      if (analysis.error) {
        errors++;
        send({ type: "skip", nom: pdf.nom, reason: analysis.error });
        continue;
      }

      // Géocodage si délibération urbanisme avec adresse
      let geo = "";
      let adresse = analysis.adresse_concernee || "";
      if (analysis.is_urbanisme && adresse) {
        const coords = await geocodeAdresse(adresse);
        if (coords) {
          geo = JSON.stringify(coords);
          adresse = coords.adresse;
          send({ type: "geo", nom: pdf.nom, adresse });
        }
      }

      // Extraire numéro depuis le nom de fichier (del_2026_01 → "01")
      const numMatch = pdf.nom.match(/del_\d{4}_(\d+)/i);
      const numero = numMatch ? numMatch[1] : "";

      const result = db.prepare(`
        INSERT INTO deliberations
          (seance_id, numero, objet, pdf_url, pdf_nom, pdf_text, statut,
           votes_pour, votes_contre, votes_abstention,
           anomalies, points, risque_juridique, action_opposition,
           is_urba, adresse, geo)
        VALUES
          (@seance_id, @numero, @objet, @pdf_url, @pdf_nom, @pdf_text, @statut,
           @pour, @contre, @abstention,
           @anomalies, @points, @risque, @action,
           @is_urba, @adresse, @geo)
      `).run({
        seance_id: pv.id,
        numero,
        objet: analysis.objet || pdf.nom,
        pdf_url: pdf.url,
        pdf_nom: pdf.nom,
        pdf_text: text.slice(0, 15000),
        statut: (analysis.anomalies?.length > 0) ? "Alerte" : "Analysé",
        pour: analysis.votes_pour ?? 0,
        contre: analysis.votes_contre ?? 0,
        abstention: analysis.votes_abstention ?? 0,
        anomalies: JSON.stringify(analysis.anomalies || []),
        points: JSON.stringify(analysis.points_cles || []),
        risque: analysis.risque_juridique || "Aucun",
        action: analysis.action_opposition || "",
        is_urba: analysis.is_urbanisme ? 1 : 0,
        adresse,
        geo,
      });

      const delib = parseDelib(db.prepare("SELECT * FROM deliberations WHERE id = ?").get(result.lastInsertRowid));
      created.push(delib);
      done++;
      send({ type: "result", nom: pdf.nom, delib });
    } catch (err) {
      errors++;
      send({ type: "skip", nom: pdf.nom, reason: err.message });
    }
  }

  send({ type: "done", created, total: created.length, errors });
  res.end();
});

module.exports = router;
