const express = require("express");
const { getAIClient, getAIModel, getCommuneCtx } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();

router.post("/", async (req, res) => {
  const { prompt, context, mode } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt requis" });

  try {
    const c = getCommuneCtx();
    const SYSTEM_PROMPT = `Tu es un expert en droit municipal français et contrôle de légalité des collectivités locales.
Tu assistes l'opposition municipale de ${c.nom} (${c.cp}, ~${c.population} hab.).
Conseil : Maire ${c.maire}, ${c.nb_conseillers} conseillers, quorum ${c.quorum}.
Réponds en français, avec précision juridique. Cite les articles CGCT et codes applicables.
Structure avec des titres courts. Sois concret et actionnable.`;

    let systemPrompt = SYSTEM_PROMPT;
    let userContent = context ? `${prompt}\n\n---\nContexte:\n${context}` : prompt;

    if (mode === "sync") {
      systemPrompt =
        "Tu simules l'extraction de données depuis la page conseil municipal d'une mairie française (CMS Réseau des Communes). Réponds UNIQUEMENT en JSON valide, sans markdown ni backticks.";
    } else if (mode === "legifrance") {
      systemPrompt = `Tu simules une recherche dans l'API Légifrance (portail PISTE) pour des textes législatifs français.
Réponds UNIQUEMENT en JSON valide sans markdown.
Format: {"results":[{"id":"CODE-ARTICLE","titre":"...","code":"CGCT|CODE_URBANISME|LOI","article":"L2121-10","date_vigueur":"YYYY-MM-DD","resume":"...","pertinence":"Haute|Moyenne|Basse","action_opposition":"...","url":"https://www.legifrance.gouv.fr/codes/article_lc/ARTICLE"}]}`;
    }

    const client = getAIClient();
    const message = await client.messages.create({
      model: getAIModel(),
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    trackUsage("ai", message.model, message.usage);
    res.json({ text: message.content[0]?.text || "" });
  } catch (err) {
    console.error("AI error:", err.message);
    res.status(500).json({ error: "Erreur API Anthropic", detail: err.message });
  }
});

module.exports = router;
