#!/usr/bin/env node
// Extrait le texte des délibérations sans pdf_text — accès direct DB, sans serveur HTTP

process.chdir(__dirname + "/..");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { db } = require("../db");
const { extractAndAnalyze } = require("../services/pdf-analyzer");

async function geocodeAdresse(adresse) {
  const https = require("https");
  const q = encodeURIComponent(`${adresse} Fleurieux-sur-l'Arbresle`);
  return new Promise((resolve) => {
    https.get(`https://api-adresse.data.gouv.fr/search/?q=${q}&limit=1`, (res) => {
      let buf = "";
      res.on("data", d => buf += d);
      res.on("end", () => {
        try {
          const data = JSON.parse(buf);
          if (data.features?.length > 0) {
            const [lng, lat] = data.features[0].geometry.coordinates;
            resolve({ lat, lng, adresse: data.features[0].properties.label });
            return;
          }
        } catch (_) {}
        resolve(null);
      });
    }).on("error", () => resolve(null));
  });
}

const update = db.prepare(`
  UPDATE deliberations SET
    pdf_text = @pdf_text, statut = @statut,
    votes_pour = @pour, votes_contre = @contre, votes_abstention = @abstention,
    anomalies = @anomalies, points = @points,
    risque_juridique = @risque, action_opposition = @action,
    is_urba = @is_urba, adresse = @adresse, geo = @geo
  WHERE id = @id
`);

async function main() {
  const missing = db.prepare(
    "SELECT * FROM deliberations WHERE (pdf_text IS NULL OR length(pdf_text) < 100) AND pdf_url != '' ORDER BY id ASC"
  ).all();

  console.log(`\n${missing.length} délibérations sans texte à traiter\n`);

  let done = 0, errors = 0;

  for (const delib of missing) {
    process.stdout.write(`  [${done + errors + 1}/${missing.length}] ${delib.pdf_nom.slice(0, 55).padEnd(55)}\r`);
    try {
      const { text, analysis } = await extractAndAnalyze(delib.pdf_url, delib.pdf_nom);
      if (analysis.error) {
        errors++;
        process.stdout.write(`\n  SKIP: ${delib.pdf_nom} — ${analysis.error}\n`);
        continue;
      }

      let geo = delib.geo || "";
      let adresse = analysis.adresse_concernee || delib.adresse || "";
      if (analysis.is_urbanisme && adresse && !geo) {
        const coords = await geocodeAdresse(adresse);
        if (coords) { geo = JSON.stringify(coords); adresse = coords.adresse; }
      }

      update.run({
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
    } catch (err) {
      errors++;
      process.stdout.write(`\n  ERR: ${delib.pdf_nom} — ${err.message}\n`);
    }
  }

  console.log(`\n\nTerminé : ${done} extraits, ${errors} erreurs`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
