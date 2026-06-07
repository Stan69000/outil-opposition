const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { db, getConfig } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();

// Tente de scraper l'ordre du jour depuis le site mairie
async function scrapeOrdreJour() {
  const BASE_URL = getConfig("commune_mairie_url");
  try {
    const { data: html } = await axios.get(`${BASE_URL}/fr/actualites`, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Opposition-Fleurieux/1.0)" },
    });
    const $ = cheerio.load(html);
    const items = [];

    // Chercher mentions "conseil municipal" ou "ordre du jour" dans les actualités
    $("a, h2, h3, p").each((_, el) => {
      const text = $(el).text().toLowerCase();
      if (text.includes("conseil municipal") || text.includes("ordre du jour") || text.includes("convocation")) {
        const href = $(el).attr("href") || "";
        items.push({
          titre: $(el).text().trim(),
          url: href.startsWith("http") ? href : href ? BASE_URL + href : "",
        });
      }
    });

    return items.slice(0, 5);
  } catch {
    return [];
  }
}

// GET /api/agenda/current — scraping ordre du jour si disponible
router.get("/current", async (req, res) => {
  const items = await scrapeOrdreJour();
  res.json({ items, found: items.length > 0 });
});

// GET /api/agenda/predict — IA prédit l'agenda de la prochaine séance
router.get("/predict", async (req, res) => {
  const pvs = db.prepare(`
    SELECT date, objet, points, anomalies, notes
    FROM pvs
    ORDER BY date DESC
    LIMIT 20
  `).all().map(p => ({
    date: p.date,
    objet: p.objet,
    points: JSON.parse(p.points || "[]"),
    anomalies: JSON.parse(p.anomalies || "[]"),
  }));

  const questions = db.prepare("SELECT objet, statut FROM questions_ecrites ORDER BY created_at DESC LIMIT 5").all();
  const failles = db.prepare("SELECT titre, statut, date FROM failles WHERE statut != 'Résolu' ORDER BY date DESC LIMIT 5").all();

  try {
    const client = getAIClient();
    const msg = await client.messages.create({
      model: getAIModel(),
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `Tu es conseiller municipal d'opposition à ${communeLabel()}.

Historique des séances récentes :
${JSON.stringify(pvs, null, 2)}

Questions en attente de réponse :
${JSON.stringify(questions)}

Irrégularités non résolues :
${JSON.stringify(failles)}

En te basant sur les cycles récurrents (budget : janvier/mars, PLU : printemps, comptes : juin, budget supplémentaire : automne) et les sujets en cours (crématorium, PLU, CCAS…), préds l'agenda probable de la prochaine séance du conseil municipal.

Retourne UNIQUEMENT ce JSON :
{
  "date_probable": "YYYY-MM-DD ou 'indéterminée'",
  "points_probables": [
    {
      "titre": "...",
      "probabilite": "haute|moyenne|faible",
      "raison": "...",
      "questions_a_poser": ["...", "..."],
      "documents_a_demander": ["..."],
      "base_legale": "..."
    }
  ],
  "vigilances": ["..."],
  "ouverture_recommandee": "texte d'ouverture de séance recommandé pour l'opposition"
}`,
      }],
    });

    trackUsage("agenda/predict", msg.model, msg.usage);
    const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
