const axios = require("axios");
const pdfParse = require("pdf-parse");
const Anthropic = require("@anthropic-ai/sdk");
const { trackUsage } = require("./ai-tracker");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Télécharge et extrait le texte d'un PDF depuis une URL
async function extractPdfText(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 25000,
    maxContentLength: 10 * 1024 * 1024, // 10 Mo max
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Opposition-Fleurieux/1.0)" },
  });

  const buffer = Buffer.from(response.data);
  const parsed = await pdfParse(buffer);
  return parsed.text?.trim() || "";
}

// Analyse le texte d'une délibération via Claude
async function analyzeDeliberation(text, nomFichier) {
  if (!text || text.length < 50) {
    return { error: "PDF non lisible ou vide (probablement scanné)" };
  }

  // Tronquer si trop long (Claude a une limite de contexte)
  const textTronque = text.length > 8000 ? text.slice(0, 8000) + "\n[…texte tronqué]" : text;

  const prompt = `Tu es un expert en droit public des collectivités territoriales françaises.
Analyse cette délibération de conseil municipal et retourne UNIQUEMENT un JSON valide.

Nom du fichier : ${nomFichier}

Texte de la délibération :
${textTronque}

Retourne ce JSON (sans markdown, sans commentaire) :
{
  "objet": "résumé en 1 phrase de l'objet de la délibération",
  "votes_pour": null,
  "votes_contre": null,
  "votes_abstention": null,
  "anomalies": ["liste des irrégularités légales détectées, vide si aucune"],
  "cgct_refs": ["références CGCT ou Code de l'urbanisme citées ou applicables"],
  "points_cles": ["2-4 points essentiels de la délibération"],
  "risque_juridique": "Aucun|Faible|Moyen|Élevé",
  "action_opposition": "action concrète recommandée pour l'opposition ou null"
}

Pour les votes : cherche des mentions comme "adopté à X voix pour, Y contre, Z abstention".
Pour les anomalies : vérifie délais légaux, procédure, compétence, publication.`;

  const message = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  trackUsage("pdf/analyze", "claude-opus-4-5", message.usage);
  const raw = message.content[0].text.trim().replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

// Analyse un seul PDF (téléchargement + extraction + IA)
async function analyzePdf(pdfUrl, nomFichier) {
  const text = await extractPdfText(pdfUrl);
  if (!text) return { error: "Impossible d'extraire le texte" };
  const analysis = await analyzeDeliberation(text, nomFichier);
  return { text, analysis };
}

module.exports = { extractPdfText, analyzeDeliberation, analyzePdf };
