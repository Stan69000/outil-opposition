const cron = require("node-cron");
const { db } = require("../db");
const { sendNewSeancesAlert } = require("./mailer");

// Import la fonction de sync mairie sans passer par HTTP
let syncFn = null;
function registerSyncFn(fn) { syncFn = fn; }

async function runAutoSync() {
  if (!syncFn) return;
  console.log("[cron] Démarrage synchro automatique mairie...");

  try {
    const result = await syncFn();
    db.prepare(`
      INSERT INTO sync_log (ran_at, seances_found, seances_imported, triggered_by)
      VALUES (datetime('now'), @found, @imported, 'cron')
    `).run({ found: result.total + (result.alreadyPresent || 0), imported: result.total });

    if (result.imported?.length > 0) {
      console.log(`[cron] ${result.imported.length} nouvelle(s) séance(s) — envoi email + push`);
      await sendNewSeancesAlert(result.imported);
      // Push PWA
      try {
        const { sendPushNotification } = require("../routes/push");
        const dates = result.imported.map(s => s.date).join(", ");
        await sendPushNotification(
          "Nouvelle séance à Fleurieux",
          `${result.imported.length} séance(s) importée(s) : ${dates}`,
          "/pvs"
        );
      } catch (_) {}
    } else {
      console.log("[cron] Aucune nouvelle séance.");
    }
  } catch (err) {
    console.error("[cron] Erreur synchro :", err.message);
    db.prepare(`
      INSERT INTO sync_log (ran_at, seances_found, seances_imported, triggered_by, error)
      VALUES (datetime('now'), 0, 0, 'cron', @error)
    `).run({ error: err.message });
  }
}

function startCron() {
  // Chaque lundi à 8h00
  cron.schedule("0 8 * * 1", runAutoSync, { timezone: "Europe/Paris" });
  console.log("[cron] Planifié : synchro mairie chaque lundi à 8h00");
}

module.exports = { startCron, registerSyncFn, runAutoSync };
