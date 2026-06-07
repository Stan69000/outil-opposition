const { db } = require("../db");

// Prix par token en USD (Anthropic tarifs publics)
const PRICING = {
  "claude-sonnet-4-5": { input: 3 / 1_000_000,  output: 15 / 1_000_000 },
  "claude-opus-4-5":   { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  "claude-haiku-4-5":  { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
};

const insert = db.prepare(
  "INSERT INTO ai_usage_log (route, model, input_tokens, output_tokens, cost_usd) VALUES (?,?,?,?,?)"
);

function trackUsage(route, model, usage) {
  try {
    const p = PRICING[model] ?? { input: 0, output: 0 };
    const cost = usage.input_tokens * p.input + usage.output_tokens * p.output;
    insert.run(route, model, usage.input_tokens, usage.output_tokens, cost);
  } catch (err) {
    console.error("ai-tracker error:", err.message);
  }
}

module.exports = { trackUsage };
