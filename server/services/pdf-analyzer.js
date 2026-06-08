const axios = require("axios");
const mammoth = require("mammoth");
const { execFile } = require("child_process");
const { writeFile, unlink } = require("fs/promises");
const { tmpdir } = require("os");
const { join } = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { trackUsage } = require("./ai-tracker");
const { assertPublicHttpUrl } = require("./safe-fetch");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT_SUFFIX = `
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
  "action_opposition": "action concrète recommandée pour l'opposition ou null",
  "is_urbanisme": false,
  "adresse_concernee": null
}

Pour les votes : cherche des mentions comme "adopté à X voix pour, Y contre, Z abstention".
Pour les anomalies : vérifie délais légaux, procédure, compétence, publication.
Pour is_urbanisme : true si la délibération concerne PLU, permis de construire, lotissement, zone, parcelle, voirie, foncier, ZAN, EBC, SCOT.
Pour adresse_concernee : si is_urbanisme, extrais l'adresse, la rue, le lieu-dit ou la description géographique mentionnée. Sinon null.`;

async function downloadBuffer(url) {
  await assertPublicHttpUrl(url); // anti-SSRF : refuse IP internes / protocoles non http(s)
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: 15 * 1024 * 1024,
    maxRedirects: 3,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Opposition-Fleurieux/1.0)" },
  });
  return Buffer.from(response.data);
}

// Extraction texte via pdftotext (PDFs natifs)
function pdfToText(buf) {
  return new Promise((resolve) => {
    const tmpFile = join(tmpdir(), `delib_${Date.now()}_${Math.floor(Math.random()*9999)}.pdf`);
    writeFile(tmpFile, buf).then(() => {
      execFile("pdftotext", ["-enc", "UTF-8", tmpFile, "-"], (err, stdout) => {
        unlink(tmpFile).catch(() => {});
        resolve(err ? "" : stdout.trim());
      });
    }).catch(() => resolve(""));
  });
}

// Extraction texte via mammoth (fichiers .docx)
async function docxToText(buf) {
  try {
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value?.trim() || "";
  } catch {
    return "";
  }
}

// Analyse via Claude avec texte
async function analyzeWithText(text, nomFichier) {
  const textTronque = text.length > 8000 ? text.slice(0, 8000) + "\n[…texte tronqué]" : text;
  const prompt = `Tu es un expert en droit public des collectivités territoriales françaises.
Analyse cette délibération de conseil municipal et retourne UNIQUEMENT un JSON valide.

Nom du fichier : ${nomFichier}

Texte de la délibération :
${textTronque}
${PROMPT_SUFFIX}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  trackUsage("pdf/analyze-text", message.model, message.usage);
  return message.content[0].text.trim().replace(/```json|```/g, "").trim();
}

// Analyse via Claude avec PDF natif (pour PDFs scannés)
async function analyzeWithNativePdf(buf, nomFichier) {
  const b64 = buf.toString("base64");
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: b64 },
        },
        {
          type: "text",
          text: `Tu es un expert en droit public des collectivités territoriales françaises.
Analyse cette délibération de conseil municipal (nom : ${nomFichier}) et retourne UNIQUEMENT un JSON valide.
${PROMPT_SUFFIX}`,
        },
      ],
    }],
  });
  trackUsage("pdf/analyze-native", message.model, message.usage);
  return message.content[0].text.trim().replace(/```json|```/g, "").trim();
}

// Point d'entrée principal : télécharge + extrait + analyse
async function extractPdfText(url) {
  const isDocx = url.toLowerCase().includes(".docx");
  const buf = await downloadBuffer(url);

  if (isDocx) {
    return await docxToText(buf);
  }
  return await pdfToText(buf);
}

async function analyzeDeliberation(text, nomFichier, _buf) {
  if (text && text.length >= 50) {
    const raw = await analyzeWithText(text, nomFichier);
    return JSON.parse(raw);
  }

  // Fallback : PDF natif via Claude (scannés ou vides)
  if (_buf) {
    const raw = await analyzeWithNativePdf(_buf, nomFichier);
    return JSON.parse(raw);
  }

  return { error: "PDF non lisible ou vide" };
}

// Utilisé par la route /extract — télécharge une fois, essaie les deux méthodes
async function extractAndAnalyze(url, nomFichier) {
  const isDocx = url.toLowerCase().includes(".docx");
  const buf = await downloadBuffer(url);

  let text = "";
  if (isDocx) {
    text = await docxToText(buf);
  } else {
    text = await pdfToText(buf);
  }

  const analysis = await analyzeDeliberation(text, nomFichier, isDocx ? null : buf);
  return { text: text.slice(0, 15000), analysis };
}

async function analyzePdf(pdfUrl, nomFichier) {
  const { text, analysis } = await extractAndAnalyze(pdfUrl, nomFichier);
  return { text, analysis };
}

module.exports = { extractPdfText, analyzeDeliberation, analyzePdf, extractAndAnalyze };
