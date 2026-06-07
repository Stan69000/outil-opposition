const express = require("express");
const { db } = require("../db");

const router = express.Router();

// GET /api/admin/usage — stats coûts API Anthropic
router.get("/usage", (req, res) => {
  const total = db.prepare(
    "SELECT COUNT(*) as calls, SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(cost_usd) as cost FROM ai_usage_log"
  ).get();

  const byModel = db.prepare(`
    SELECT model, COUNT(*) as calls, SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(cost_usd) as cost
    FROM ai_usage_log GROUP BY model ORDER BY cost DESC
  `).all();

  const byRoute = db.prepare(`
    SELECT route, COUNT(*) as calls, SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(cost_usd) as cost
    FROM ai_usage_log GROUP BY route ORDER BY cost DESC
  `).all();

  const byDay = db.prepare(`
    SELECT substr(called_at, 1, 10) as day, COUNT(*) as calls, SUM(cost_usd) as cost
    FROM ai_usage_log GROUP BY day ORDER BY day DESC LIMIT 30
  `).all();

  const recent = db.prepare(
    "SELECT * FROM ai_usage_log ORDER BY id DESC LIMIT 50"
  ).all();

  res.json({ total, byModel, byRoute, byDay, recent });
});

module.exports = router;
