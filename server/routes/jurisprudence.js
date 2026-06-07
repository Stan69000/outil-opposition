const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const Anthropic = require("@anthropic-ai/sdk");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BASE_LF = "https://www.legifrance.gouv.fr";

// Scrape la recherche jurisprudence Légifrance (Cheerio — PISTE /search est cassé)
async function scrapeJurisprudence(q) {
  const url = `${BASE_LF}/search/juri?tab_selection=juri&query=${encodeURIComponent(q)}&searchField=ALL&typePagination=DEFAULT&sortValue=SCORE&pageSize=10&page=1`;

  const { data: html } = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept-Language": "fr-FR,fr;q=0.9",
    },
  });

  const $ = cheerio.load(html);
  const results = [];

  // Légifrance search results structure
  $(".result-item, article.result, .search-result-item").each((_, el) => {
    const $el = $(el);
    const titre = $el.find("h2, h3, .title, .result-title").first().text().trim();
    const href = $el.find("a").first().attr("href") || "";
    const date = $el.find("time, .date, .result-date").first().text().trim();
    const extrait = $el.find("p, .abstract, .result-abstract").first().text().trim();

    if (titre && titre.length > 5) {
      results.push({
        titre,
        url: href.startsWith("http") ? href : BASE_LF + href,
        date,
        extrait: extrait.slice(0, 300),
        juridiction: titre.includes("CAA") ? "Cour Administrative d'Appel" :
                     titre.includes("TA") ? "Tribunal Administratif" :
                     titre.includes("CE") ? "Conseil d'État" : "Juridiction administrative",
      });
    }
  });

  return results;
}

// GET /api/jurisprudence/search?q=...&juridiction=ta-lyon
router.get("/search", async (req, res) => {
  const { q, juridiction } = req.query;
  if (!q) return res.status(400).json({ error: "paramètre q requis" });

  try {
    // Enrichir la query avec le contexte
    const queryEnrichie = juridiction === "ta-lyon"
      ? `${q} commune municipale Rhône Lyon`
      : `${q} commune collectivité territoriale`;

    let results = await scrapeJurisprudence(queryEnrichie);

    // Si scraping échoue ou résultats vides → fallback IA
    if (results.length === 0) {
      const msg = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `Cite 3-4 décisions de jurisprudence administrative française réelles et pertinentes pour : "${q}" dans le contexte d'une commune de 2000 habitants. Focus sur TA Lyon, CAA Lyon, CE si possible.
Retourne UNIQUEMENT ce JSON :
{"results":[{"titre":"Conseil d'État, X décembre XXXX, n°XXXXXX","url":"https://www.legifrance.gouv.fr/ceta/id/CETATEXT...","date":"YYYY-MM-DD","juridiction":"Conseil d'État","extrait":"résumé de l'apport de la décision en 1-2 phrases","pertinence":"explication de la pertinence pour une opposition municipale"}]}`,
        }],
      });
      const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(raw);
      results = (parsed.results || []).map(r => ({ ...r, source: "ia-fallback" }));
    }

    res.json({ results, total: results.length, query: q });
  } catch (err) {
    console.error("Jurisprudence error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
