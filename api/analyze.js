// api/analyze.js — AI insight generator (AI agent) for dashboard
// Call an OpenAI-compatible LLM with the aggregated report data.
// Falls back to rule-based summary if no key / error.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { report } = req.body || {};
    if (!report || !report.overall) return res.status(400).json({ error: 'report required' });

    const apiKey = process.env.OPENAI_API_KEY || '';
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';

    // Compact digest for the model
    const digest = [
      `Period: ${report.currentMonthLabel} vs ${report.prevMonthLabel}`,
      `Overall: ${report.overall.map(m => `${m.metric} ${m.curr} (Δ ${m.delta == null ? '—' : m.delta.toFixed(1)}%)`).join(' | ')}`,
      `Hosts: ${report.hosts.slice(0, 8).map(h => `${h.host} GMV ${h.gmv.toFixed(2)} slots ${h.slots} avgGmv ${h.avgGmv.toFixed(2)} CTR ${h.ctrNum?.toFixed(2) ?? '—'}% CTOR ${h.ctorNum?.toFixed(2) ?? '—'}%`).join('; ')}`,
      `Time slots: ${report.timeSlots.map(t => `${t.slot} GMV ${t.gmv.toFixed(2)} avg ${t.avgGmv.toFixed(2)} slots ${t.slots}`).join(' | ')}`
    ].join('\n');

    let insights;
    if (apiKey) {
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'deepseek/deepseek-chat-v3-1:free',
          messages: [
            { role: 'system', content: 'You are a TikTok livestream data analyst. Based on the report data, produce 3 concise bullet-point insights in English, each under 20 words, highlighting strongest/weakest performers, notable % changes, and one actionable recommendation. Start each bullet with "• ". No preamble.' },
            { role: 'user', content: digest }
          ],
          max_tokens: 250,
          temperature: 0.4
        })
      });
      const d = await r.json();
      if (r.ok && d.choices?.[0]?.message?.content) {
        insights = d.choices[0].message.content.trim();
      }
    }

    if (!insights) {
      // Fallback: rule-based
      const topSlot = report.timeSlots[0];
      const topHost = report.hosts?.[0];
      const gmv = report.overall.find(m => m.metric.includes('GMV:')) || {};
      const lines = [];
      lines.push(`• ${topSlot?.slot || 'Best'} session led with RM ${(topSlot?.avgGmv ?? 0).toFixed(2)} avg GMV across ${topSlot?.slots ?? 0} broadcasts.`);
      if (gmv.delta != null) lines.push(`• Overall GMV ${gmv.delta >= 0 ? 'grew' : 'declined'} ${Math.abs(gmv.delta).toFixed(1)}% vs previous month.`);
      if (topHost) lines.push(`• Top host ${topHost.host} drove RM ${topHost.gmv.toFixed(2)} across ${topHost.slots} slots.`);
      insights = lines.join('\n');
    }

    return res.status(200).json({ insights });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
