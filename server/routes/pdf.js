const express = require("express");
const { db, parsePv } = require("../db");
const { analyzePdf } = require("../services/pdf-analyzer");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const pdfLimiter = rateLimit({ windowMs: 60_000, max: 10,
  message: { error: "Trop d'analyses PDF simultanées, réessayez dans une minute." } });

// POST /api/pdf/analyze  { pvId, pdfUrl, pdfNom }
router.post("/analyze", pdfLimiter, async (req, res) => {
  const { pvId, pdfUrl, pdfNom } = req.body;
  if (!pvId || !pdfUrl) return res.status(400).json({ error: "pvId et pdfUrl requis" });

  try {
    const { text, analysis } = await analyzePdf(pdfUrl, pdfNom || "délibération");

    if (analysis.error) {
      return res.status(422).json({ error: analysis.error });
    }

    // Mettre à jour le PV avec les données extraites
    const pv = db.prepare("SELECT * FROM pvs WHERE id = ?").get(pvId);
    if (!pv) return res.status(404).json({ error: "PV introuvable" });

    // Fusionner avec anomalies existantes (dédupliquées)
    const existingAnomalies = JSON.parse(pv.anomalies || "[]");
    const newAnomalies = analysis.anomalies || [];
    const mergedAnomalies = [...new Set([...existingAnomalies, ...newAnomalies])];

    const existingPoints = JSON.parse(pv.points || "[]");
    const newPoints = analysis.points_cles || [];
    const mergedPoints = existingPoints.length > 2 ? existingPoints : [...new Set([...existingPoints, ...newPoints])];

    // Votes : ne mettre à jour que si trouvés dans le PDF et actuellement à 0
    const updateVotes = (field, val) =>
      val !== null && val !== undefined && pv[field] === 0 ? val : pv[field];

    db.prepare(`
      UPDATE pvs SET
        anomalies = @anomalies,
        points = @points,
        pdf_text = @pdf_text,
        ai_analysed = 1,
        votes_pour = @pour,
        votes_contre = @contre,
        votes_abstention = @abstention,
        statut = CASE
          WHEN @anomalies != '[]' AND statut = 'Importé' THEN 'Alerte'
          WHEN @anomalies = '[]' AND statut = 'Importé' THEN 'Analysé'
          ELSE statut
        END
      WHERE id = @id
    `).run({
      id: pvId,
      anomalies: JSON.stringify(mergedAnomalies),
      points: JSON.stringify(mergedPoints),
      pdf_text: text.slice(0, 20000), // limiter stockage
      pour: updateVotes("votes_pour", analysis.votes_pour),
      contre: updateVotes("votes_contre", analysis.votes_contre),
      abstention: updateVotes("votes_abstention", analysis.votes_abstention),
    });

    const updated = parsePv(db.prepare("SELECT * FROM pvs WHERE id = ?").get(pvId));
    res.json({ pv: updated, analysis });
  } catch (err) {
    console.error("PDF analyze error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/pdf/analyze-seance  { pvId } — analyse TOUS les PDFs d'une séance
router.post("/analyze-seance", pdfLimiter, async (req, res) => {
  const { pvId } = req.body;
  if (!pvId) return res.status(400).json({ error: "pvId requis" });

  const pv = db.prepare("SELECT * FROM pvs WHERE id = ?").get(pvId);
  if (!pv) return res.status(404).json({ error: "PV introuvable" });

  const pdfs = JSON.parse(pv.pdfs || "[]");
  if (pdfs.length === 0) return res.status(400).json({ error: "Aucun PDF dans ce PV" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  let allAnomalies = [];
  let allPoints = [];
  let textes = [];
  let analysed = 0;
  let errors = 0;

  for (const pdf of pdfs) {
    send({ type: "progress", current: analysed + 1, total: pdfs.length, nom: pdf.nom });
    try {
      const { text, analysis } = await analyzePdf(pdf.url, pdf.nom);
      if (!analysis.error) {
        allAnomalies.push(...(analysis.anomalies || []));
        allPoints.push(...(analysis.points_cles || []));
        if (text) textes.push(`=== ${pdf.nom} ===\n${text}`);
        analysed++;
        send({ type: "result", nom: pdf.nom, analysis });
      } else {
        errors++;
        send({ type: "skip", nom: pdf.nom, reason: analysis.error });
      }
    } catch (err) {
      errors++;
      send({ type: "skip", nom: pdf.nom, reason: err.message });
    }
  }

  // Sauvegarder le résultat agrégé
  const deduped = [...new Set(allAnomalies)];
  const dedupedPts = [...new Set(allPoints)].slice(0, 10);
  const fullText = textes.join("\n\n").slice(0, 30000);

  db.prepare(`
    UPDATE pvs SET anomalies=@anomalies, points=@points, pdf_text=@pdf_text, ai_analysed=1,
    statut = CASE WHEN @hasAnomalies AND statut='Importé' THEN 'Alerte'
                  WHEN NOT @hasAnomalies AND statut='Importé' THEN 'Analysé'
                  ELSE statut END
    WHERE id=@id
  `).run({
    id: pvId,
    anomalies: JSON.stringify(deduped),
    points: JSON.stringify(dedupedPts),
    pdf_text: fullText,
    hasAnomalies: deduped.length > 0 ? 1 : 0,
  });

  const updated = parsePv(db.prepare("SELECT * FROM pvs WHERE id = ?").get(pvId));
  send({ type: "done", pv: updated, analysed, errors });
  res.end();
});

module.exports = router;
