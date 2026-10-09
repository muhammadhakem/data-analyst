// api/analyze.js — AI insight generator (AI agent) for dashboard
// Call an OpenAI-compatible LLM with the aggregated report data.
// Falls back to rule-based summary if no key / error.

const DEFAULT_SYS = `You are a sharp TikTok livestream data analyst for a Malaysian brand. Write like a friendly human analyst, NOT a spreadsheet.

You receive TWO months of aggregated data (current vs previous) with % deltas for every metric.

RULES FOR WRITING (the reader finds raw numbers hard to read — keep it clean):
- Short, natural sentences. One idea per sentence. Max ~18 words.
- Lead with the conclusion, then the number that proves it. Never dump a formula like "(-2.4% slots vs -10% GMV)".
  Good: "Slots only dipped 2%, but GMV fell 10% — so each slot earned less."
  Bad: "Slots -2.4% vs GMV -10.0%, giving a -7.6pp gap."
- Bold ONLY the one key number per sentence using **double asterisks**. Max 1-2 bold per line.
- Say direction in words: "up X%" / "down X%", never "+X" alone.
- Ignore Average Price unless it is the main story. Focus on sold items: was it a big campaign month, a BAU month, or a product-mix change?
- Small moves (under ~5%) = normal, say so briefly. Big gaps = explain the likely cause.
- If slots and GMV move differently, explain the per-slot efficiency in plain words.

WHAT TO COVER:
Overall — 2-3 bullets on the headline story (slots vs GMV efficiency, the sold-items / campaign angle).
Hosts — top 3 performers with WHY (one line each), then one worst or mid-group host with WHY. One punchy sentence each.
Best Time Slot — 1 line: which slot won and one notable shift.
Observation & Suggestions — 2-3 concrete next actions, one line each.

Format: section heading alone on its own line, then bullets. Plain, natural English. No preamble, no filler.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { report, prompt } = req.body || {};
    if (!report || !report.overall) return res.status(400).json({ error: 'report required' });

    const apiKey = process.env.OPENAI_API_KEY || '';
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';
    const sysPrompt = (prompt && String(prompt).trim()) ? String(prompt).trim() : DEFAULT_SYS;

    const pct = (d) => d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
    const n2 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

    // Full digest with deltas + previous values (so the model can reason about causes)
    const digest = [
      `Period: ${report.currentMonthLabel} vs ${report.prevMonthLabel}`,
      `OVERALL (current, previous, %delta):`,
      ...report.overall.map(m => `  - ${m.metric} ${n2(m.curr)} | prev ${n2(m.prev)} | delta ${pct(m.delta)}`),
      '',
      `HOSTS (current month) — sorted by avg GMV/slot:`,
      ...report.hosts.slice(0, 12).map(h =>
        `  - ${h.host}: GMV ${n2(h.gmv)} (prev ${n2(h.prevGmv)}, delta ${pct(h.dGmv)}) | slots ${h.slots} (prev ${h.prevSlots ?? '—'}, delta ${pct(h.dSlots)}) | avgGMV/slot ${n2(h.avgGmv)} (delta ${pct(h.dAvgGmv)}) | CTR ${h.ctrNum?.toFixed(2) ?? '—'}% | CTOR ${h.ctorNum?.toFixed(2) ?? '—'}%`
      ),
      '',
      `TIME SLOTS (current month):`,
      ...report.timeSlots.map(t =>
        `  - ${t.slot}: GMV ${n2(t.gmv)} (prev ${n2(t.prevGmv)}, delta ${pct(t.dGmv)}) | avgGMV/slot ${n2(t.avgGmv)} (prev ${n2(t.prevAvgGmv)}, delta ${pct(t.dAvgGmv)}) | slots ${t.slots} (prev ${t.prevSlots ?? '—'})`
      )
    ].join('\n');

    let insights;
    if (apiKey) {
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'cohere/north-mini-code:free',
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: digest }
          ],
          max_tokens: 1200,
          temperature: 0.4
        })
      });
      const d = await r.json();
      if (r.ok && d.choices?.[0]?.message?.content) {
        insights = d.choices[0].message.content.trim();
      }
    }

    if (!insights) {
      // Fallback: rule-based (checks slot vs GMV correlation)
      const find = (k) => report.overall.find(m => m.metric.toLowerCase().includes(k)) || {};
      const gmv = find('gmv:'), slots = find('slot'), views = find('views'), sold = find('sold');
      const lines = [];
      if (gmv.delta != null && slots.delta != null) {
        const gap = gmv.delta - slots.delta;
        lines.push(`• GMV ${gmv.delta >= 0 ? '+' : ''}${gmv.delta.toFixed(1)}% vs slots ${slots.delta >= 0 ? '+' : ''}${slots.delta.toFixed(1)}% → per-slot efficiency ${gap >= 0 ? 'up' : 'down'} ${Math.abs(gap).toFixed(1)}pp (${Math.abs(gap) > 5 ? 'notable' : 'normal'}).`);
      }
      if (views.delta != null && sold.delta != null) lines.push(`• Views ${views.delta >= 0 ? '+' : ''}${views.delta.toFixed(1)}% vs items sold ${sold.delta >= 0 ? '+' : ''}${sold.delta.toFixed(1)}%.`);
      const topSlot = report.timeSlots[0];
      if (topSlot) lines.push(`• Best slot: ${topSlot.slot} — RM ${n2(topSlot.avgGmv)} avg/slot across ${topSlot.slots} sessions.`);
      const topHost = report.hosts?.[0];
      if (topHost) lines.push(`• Top host: ${topHost.host} — RM ${n2(topHost.gmv)} across ${topHost.slots} slots.`);
      insights = lines.join('\n');
    }

    return res.status(200).json({ insights });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}