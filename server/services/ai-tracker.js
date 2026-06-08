const { db } = require("../db");

// Prix par token en USD (tarifs publics Anthropic, $/million de tokens)
const PRICING = {
  "claude-opus-4-5":   { input: 5 / 1_000_000,  output: 25 / 1_000_000 },
  "claude-sonnet-4-5": { input: 3 / 1_000_000,  output: 15 / 1_000_000 },
  "claude-haiku-4-5":  { input: 1 / 1_000_000,  output: 5 / 1_000_000 },
};

const insert = db.prepare(
  "INSERT INTO ai_usage_log (route, model, input_tokens, output_tokens, cost_usd) VALUES (?,?,?,?,?)"
);

function resolvePrice(model) {
  if (PRICING[model]) return PRICING[model];
  const key = Object.keys(PRICING).find(k => model.startsWith(k));
  return key ? PRICING[key] : { input: 0, output: 0 };
}

function trackUsage(route, model, usage) {
  try {
    const p = resolvePrice(model);
    const cost = usage.input_tokens * p.input + usage.output_tokens * p.output;
    insert.run(route, model, usage.input_tokens, usage.output_tokens, cost);
  } catch (err) {
    console.error("ai-tracker error:", err.message);
  }
}

module.exports = { trackUsage };
