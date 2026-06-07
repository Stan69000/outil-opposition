const nodemailer = require("nodemailer");

function createTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendNewSeancesAlert(seances) {
  const transport = createTransport();
  if (!transport || !process.env.ALERT_EMAIL) {
    console.log("[mailer] SMTP non configuré — email ignoré");
    return;
  }

  const lignes = seances.map(s =>
    `• ${s.date} — ${s.pdfs?.length || 0} délibération(s)\n` +
    (s.pdfs || []).slice(0, 5).map(p => `  ↓ ${p.nom}`).join("\n")
  ).join("\n\n");

  const recoursAlert = seances
    .filter(s => s.jours_recours !== null && s.jours_recours <= 30 && s.jours_recours > 0)
    .map(s => `⚑ ${s.date} — recours expire dans ${s.jours_recours} jours (${s.recours_limite})`)
    .join("\n");

  await transport.sendMail({
    from: `"Veille Fleurieux" <${process.env.SMTP_USER}>`,
    to: process.env.ALERT_EMAIL,
    subject: `[Fleurieux Opp] ${seances.length} nouvelle(s) séance(s) détectée(s)`,
    text: `Bonjour,

La synchronisation automatique a détecté ${seances.length} nouvelle(s) séance(s) sur le site de la mairie de Fleurieux-sur-l'Arbresle.

${lignes}

${recoursAlert ? `⚠ DÉLAIS DE RECOURS URGENTS :\n${recoursAlert}\n` : ""}

Accéder à l'application :
http://${process.env.APP_HOST || "localhost:5173"}

--
Opposition Municipale Fleurieux · Veille automatique
`,
  });

  console.log(`[mailer] Email envoyé à ${process.env.ALERT_EMAIL}`);
}

module.exports = { sendNewSeancesAlert };
