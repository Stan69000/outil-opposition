#!/usr/bin/env node
// Lance l'extraction IA de toutes les délibérations pour tous les PVs avec PDFs

const http = require("http");

const BASE = "http://localhost:3001";

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, res => {
      let buf = "";
      res.on("data", d => buf += d);
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch(e) { reject(e); } });
    }).on("error", reject);
  });
}

function extractPv(pvId) {
  return new Promise((resolve) => {
    const req = http.request(`${BASE}/api/deliberations/extract/${pvId}`, { method: "POST" }, res => {
      let buf = "";
      let done = 0, errors = 0;

      res.on("data", chunk => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === "progress") process.stdout.write(`  [${evt.current}/${evt.total}] ${evt.nom.slice(0, 50)}\r`);
            if (evt.type === "result")   done++;
            if (evt.type === "skip")     errors++;
            if (evt.type === "done")     resolve({ done: evt.total, errors });
          } catch {}
        }
      });

      res.on("end", () => resolve({ done, errors }));
      res.on("error", () => resolve({ done: 0, errors: 1 }));
    });
    req.on("error", () => resolve({ done: 0, errors: 1 }));
    req.end();
  });
}

async function main() {
  const pvs = await fetchJson("/api/pvs");
  const withPdfs = pvs.filter(p => p.pdfs?.length > 0);
  const totalPdfs = withPdfs.reduce((s, p) => s + p.pdfs.length, 0);

  console.log(`\n=== Extraction IA : ${withPdfs.length} séances, ${totalPdfs} PDFs ===\n`);

  let totalDone = 0, totalErrors = 0;

  for (let i = 0; i < withPdfs.length; i++) {
    const pv = withPdfs[i];
    const ts = new Date().toLocaleTimeString("fr-FR");
    process.stdout.write(`\n[${i+1}/${withPdfs.length}] ${ts} — ${pv.date} (${pv.pdfs.length} PDFs)\n`);

    const { done, errors } = await extractPv(pv.id);
    totalDone   += done;
    totalErrors += errors;
    console.log(`  OK: ${done} extraites, ${errors} erreurs`);
  }

  console.log(`\n=== Terminé : ${totalDone} délibérations extraites, ${totalErrors} erreurs ===\n`);
}

main().catch(err => { console.error("Erreur fatale:", err.message); process.exit(1); });
