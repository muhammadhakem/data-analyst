// api/analyze.js — AI insight generator (AI agent) for dashboard
// Call an OpenAI-compatible LLM with the aggregated report data.
// Falls back to rule-based summary if no key / error.

const DEFAULT_SYS = `You are a sharp TikTok livestream data analyst for a Malaysian brand.

You receive TWO months of aggregated data (current vs previous) with % deltas for every metric:
Total Slots, GMV, Avg GMV/slot, New Followers, CTR, CTOR, Views, Product Clicks, Comments, Avg Price, Items Sold.

Your job is CAUSAL, correlation-first analysis — not a list of numbers:

1. SANITY-CHECK deltas against each other. Metrics should move together:
   - If Total Slots changes X%, GMV should roughly follow. A gap between slot-delta and GMV-delta means per-slot efficiency changed — call it out (e.g. "slots -2% but GMV -10% means each slot earned ~8% less").
   - Views -> Product Clicks -> Items Sold -> GMV form a funnel. Flag any metric that breaks rank order.
   - Focus on ITEMS SOLD as a driver: explain why it moved — big sales campaign / BAU (business-as-usual) / product mix. Average Price is minor, mention briefly only if relevant.
2. Gap under ~5pp = normal noise, say so, do not alarm. Large gap = state likely cause + what data would confirm it.
3. For hosts: cover the TOP 3 performers in detail WHY, then pick the WORST host OR a mid-performance group (whichever tells the better story) — explain why (slot count change vs per-slot value change, campaign/consistency).
4. For time slots: give a short summary of the BEST time slot and any notable mover. Do not list every slot.

Output format (plain text, tight, NO markdown asterisks):
Overall
- 2-4 bullets, each citing actual numbers and the correlation reasoning.
Hosts
- Top 3 + worst/mid group, each with the why.
Best Time Slot
- 1-2 lines: which slot performed best and any notable shift.
Observation & Suggestions
- 2-3 concrete actionable items.

Cite real numbers. Be direct. No preamble, no filler.`;

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