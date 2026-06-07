const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { db, parsePv } = require("../db");

const router = express.Router();

const BASE_URL = "https://fleurieuxsurlarbresle.fr";
const MAIN_URL = `${BASE_URL}/fr/rb/2187928/deliberations-prises`;

const MOIS = {
  janvier:"01", février:"02", mars:"03", avril:"04", mai:"05", juin:"06",
  juillet:"07", août:"08", septembre:"09", octobre:"10", novembre:"11", décembre:"12",
};

function parseDateFr(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})\s+([\wÀ-ÿ]+)\s+(\d{4})/i);
  if (!m) return null;
  const mois = MOIS[m[2].toLowerCase()];
  if (!mois) return null;
  return `${m[3]}-${mois}-${m[1].padStart(2, "0")}`;
}

function capitalizeFr(str) {
  // "creation crematorium" → "Création crématorium"
  // On capitalise juste la première lettre
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function nomFromLinkText(text) {
  let nom = text
    .replace(/^file_download/i, "")          // icône CMS Neopse
    .replace(/\s*\(PDF[^)]*\)$/i, "")        // "(PDF - 310.56 kB)"
    .replace(/\.pdf$/i, "")                  // extension résiduelle
    .trim();

  // "del_2026_04 tableau emplois v2" (espace après numéro — 2026+)
  // "del_2020_01_lancement_procedure_DSP" (underscore — 2020-2022)
  nom = nom.replace(/^(?:del|cr)_\d{4}_\d+[_\s]/i, "");

  // Remplacer les underscores restants par des espaces
  nom = nom.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  // Retirer le suffixe de version "v2", "v3" en fin
  nom = nom.replace(/\s+v\d+$/i, "").trim();

  return capitalizeFr(nom);
}

// Scrape une page (URL) et retourne les séances avec leurs PDFs
async function scrapePage(url) {
  const { data: html } = await axios.get(url, {
    timeout: 12000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Opposition-Fleurieux/1.0)" },
  });

  const $ = cheerio.load(html);
  const seances = [];

  $("p.title").each((_, heading) => {
    const text = $(heading).text().trim();
    const dateStr = text.match(/le\s+(.+)$/i)?.[1];
    const date = parseDateFr(dateStr);
    if (!date) return;

    const seen = new Set();
    const pdfs = [];

    $(heading).parent().find("a[href]").each((_, a) => {
      const href = $(a).attr("href") || "";
      if (!href.includes("neopse.com") && !href.toLowerCase().includes(".pdf")) return;
      if (seen.has(href)) return;
      seen.add(href);

      const rawText = $(a).text().trim();
      const nom = nomFromLinkText(rawText) || capitalizeFr(href.split("/").pop().replace(/\.pdf$/i, ""));
      pdfs.push({ nom, url: href });
    });

    if (pdfs.length > 0) {
      seances.push({ date, dateStr, pdfs, sourceUrl: url });
    }
  });

  return seances;
}

// Récupère les URLs des années dans le sidebar de la page principale
async function getYearUrls() {
  const { data: html } = await axios.get(MAIN_URL, {
    timeout: 10000,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Opposition-Fleurieux/1.0)" },
  });
  const $ = cheerio.load(html);
  const years = [];

  $("a[href]").each((_, el) => {
    const text = $(el).text().replace(/keyboard_arrow_right/g, "").trim();
    const href = $(el).attr("href") || "";
    if (/^20[0-9]{2}$/.test(text) && href.startsWith("/fr/")) {
      years.push({ year: text, url: BASE_URL + href });
    }
  });

  return years;
}

router.get("/sync", async (req, res) => {
  const logs = [];
  const log = (msg, type = "info") => logs.push({ msg, type, ts: new Date().toLocaleTimeString("fr-FR") });

  try {
    // 1. Récupérer les URLs des années + l'année courante
    log("Récupération des pages années...");
    const yearUrls = await getYearUrls();
    const allUrls = [MAIN_URL, ...yearUrls.map(y => y.url)];
    log(`${yearUrls.length} année(s) trouvée(s) + page courante`);

    // 2. Scraper toutes les pages
    const existingDates = new Set(
      db.prepare("SELECT date FROM pvs WHERE source = 'auto'").all().map(r => r.date)
    );

    const imported = [];

    for (const url of allUrls) {
      const label = url === MAIN_URL ? "page courante" : url.split("/").pop();
      log(`Scraping ${label}...`);

      let seances;
      try {
        seances = await scrapePage(url);
      } catch (err) {
        log(`Erreur sur ${label} : ${err.message}`, "warn");
        continue;
      }

      const newOnes = seances.filter(s => !existingDates.has(s.date));
      log(`  → ${seances.length} séance(s), ${newOnes.length} nouvelle(s)`);

      for (const seance of newOnes) {
        const objet = `Délibérations du ${seance.dateStr}`;
        const points = seance.pdfs.map(p => p.nom);

        const result = db.prepare(`
          INSERT INTO pvs (date, objet, source, statut, votes_pour, votes_contre, votes_abstention,
            points, anomalies, notes, url_source, pdfs)
          VALUES (@date, @objet, 'auto', 'Importé', 0, 0, 0,
            @points, '[]', @notes, @url_source, @pdfs)
        `).run({
          date: seance.date,
          objet,
          points: JSON.stringify(points),
          notes: `${seance.pdfs.length} délibération(s)`,
          url_source: seance.sourceUrl,
          pdfs: JSON.stringify(seance.pdfs),
        });

        const created = parsePv(db.prepare("SELECT * FROM pvs WHERE id = ?").get(result.lastInsertRowid));
        imported.push(created);
        existingDates.add(seance.date);
        log(`  Importé : ${seance.date} — ${seance.pdfs.length} délib.`, "success");
      }

      // Petite pause pour ne pas surcharger le serveur
      await new Promise(r => setTimeout(r, 300));
    }

    if (imported.length === 0) {
      log("Toutes les séances sont déjà synchronisées", "info");
    } else {
      log(`${imported.length} séance(s) importée(s) au total`, "success");
    }

    res.json({ logs, imported, total: imported.length });
  } catch (err) {
    log(`Erreur : ${err.message}`, "error");
    res.status(500).json({ logs, imported: [], total: 0, error: err.message });
  }
});

// Exposé pour le cron (appelable sans HTTP)
async function runSync() {
  const existingDates = new Set(
    db.prepare("SELECT date FROM pvs WHERE source = 'auto'").all().map(r => r.date)
  );
  const yearUrls = await getYearUrls();
  const allUrls = [MAIN_URL, ...yearUrls.map(y => y.url)];
  const imported = [];
  for (const url of allUrls) {
    const seances = await scrapePage(url).catch(() => []);
    for (const seance of seances.filter(s => !existingDates.has(s.date))) {
      const result = db.prepare(`
        INSERT INTO pvs (date, objet, source, statut, votes_pour, votes_contre, votes_abstention,
          points, anomalies, notes, url_source, pdfs)
        VALUES (@date, @objet, 'auto', 'Importé', 0, 0, 0, @points, '[]', @notes, @url_source, @pdfs)
      `).run({
        date: seance.date,
        objet: `Délibérations du ${seance.dateStr}`,
        points: JSON.stringify(seance.pdfs.map(p => p.nom)),
        notes: `${seance.pdfs.length} délibération(s)`,
        url_source: seance.sourceUrl,
        pdfs: JSON.stringify(seance.pdfs),
      });
      const created = parsePv(db.prepare("SELECT * FROM pvs WHERE id = ?").get(result.lastInsertRowid));
      imported.push(created);
      existingDates.add(seance.date);
    }
  }
  return { imported, total: imported.length };
}

router.syncFn = runSync;
module.exports = router;
