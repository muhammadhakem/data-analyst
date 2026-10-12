// api/analyze.js — AI insight generator (AI agent) for dashboard
// Deterministic findings computed in-code FIRST, then an LLM only PHRASES them.
// ponytail: LLM as narrator, not as calculator — free models botch arithmetic.

// ── deterministic findings ────────────────────────────────────────────────
function computeFindings(report) {
  const F = [];
  const M = {};
  (report.overall || []).forEach(m => { M[String(m.metric).toLowerCase()] = m; });
  const g = (frag) => { const k = Object.keys(M).find(k => k.includes(frag)); return k ? M[k] : null; };
  const sl = (d) => d == null ? 'n/a' : (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
  const rm = (v) => (v == null ? 'n/a' : Number(v).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
  const band = (d) => d == null ? 'n/a' : (Math.abs(d) < 5 ? 'normal noise (<5%)' : Math.abs(d) < 15 ? 'moderate (5-15%)' : 'severe (>15%)');

  const gmv = g('gmv:'), slots = g('total slots'), perSlot = g('per slot');
  const views = g('views'), clicks = g('product clicks'), sold = g('items sold');
  const aov = g('average price'), ctor = g('ctor'), fol = g('followers');
  const hasPrev = !!(gmv && gmv.prev);

  // 1. Volume-vs-value efficiency
  if (gmv && slots) {
    const gap = (gmv.delta ?? 0) - (slots.delta ?? 0);
    F.push(`EFFICIENCY: slots moved ${sl(slots.delta)}, GMV moved ${sl(gmv.delta)}. ` +
      (Math.abs(gap) > 5
        ? `Gap of ${gap.toFixed(1)}pp is REAL — value per slot diverged from volume. Avg GMV/slot ${sl(perSlot && perSlot.delta)}.`
        : `Gap of ${gap.toFixed(1)}pp — slots and GMV moved together (healthy).`));
  }

  // 2. RM attribution — who drove the total GMV change
  if (gmv && hasPrev && report.hosts && report.hosts.length) {
    const totalChg = (gmv.curr ?? 0) - (gmv.prev ?? 0);
    const deltas = report.hosts
      .filter(h => h.prevGmv != null)
      .map(h => ({ host: h.host, chg: h.gmv - h.prevGmv }))
      .sort((a, b) => a.chg - b.chg);
    const drags = deltas.filter(d => d.chg < 0).slice(0, 3)
      .map(d => `${d.host} −RM ${rm(Math.abs(d.chg))}`);
    const gains = deltas.filter(d => d.chg > 0).slice(-2).reverse()
      .map(d => `${d.host} +RM ${rm(d.chg)}`);
    F.push(`ATTRIBUTION: total GMV changed RM ${totalChg >= 0 ? '+' : '−'}${rm(Math.abs(totalChg))}. ` +
      `Biggest drags: ${drags.length ? drags.join(', ') : 'none'}. ` +
      `Offsetting gains: ${gains.length ? gains.join(', ') : 'none'}.`);
  }

  // 3. Funnel coherence: Views → Clicks → Sold → AOV
  if (views && clicks && sold) {
    const parts = [`views ${sl(views.delta)}`, `clicks ${sl(clicks.delta)}`, `items sold ${sl(sold.delta)}`];
    let conv = '';
    if (hasPrev && views.prev && clicks.prev && clicks.curr && sold.curr) {
      const clickRateC = clicks.curr / views.curr, clickRateP = clicks.prev / views.prev;
      const soldRateC = sold.curr / clicks.curr, soldRateP = sold.prev / clicks.prev;
      const dCR = ((clickRateC - clickRateP) / clickRateP) * 100;
      const dSR = ((soldRateC - soldRateP) / soldRateP) * 100;
      const worst = Math.abs(dCR) > Math.abs(dSR)
        ? `click-through (views→clicks) ${sl(dCR)}` : `checkout (clicks→sold) ${sl(dSR)}`;
      conv = ` Funnel bottleneck: ${worst}. Click-rate ${(clickRateC*100).toFixed(1)}%, checkout-rate ${(soldRateC*100).toFixed(1)}%.`;
    }
    F.push(`FUNNEL: ${parts.join(', ')}.${conv} AOV ${sl(aov && aov.delta)}.`);
  }

  // 4. Severity band + CTOR
  if (gmv) F.push(`SEVERITY: GMV move ${sl(gmv.delta)} = ${band(gmv.delta)} vs last month. CTOR ${sl(ctor && ctor.delta)}. Followers ${sl(fol && fol.delta)}.`);

  // 5. Concentration risk
  if (gmv && gmv.curr && report.hosts && report.hosts.length) {
    const sorted = [...report.hosts].sort((a, b) => b.gmv - a.gmv);
    const top1 = sorted[0], top3 = sorted.slice(0, 3).reduce((a, h) => a + h.gmv, 0);
    F.push(`CONCENTRATION: ${top1.host} alone = ${((top1.gmv / gmv.curr) * 100).toFixed(0)}% of GMV. ` +
      `Top 3 hosts = ${((top3 / gmv.curr) * 100).toFixed(0)}%.` +
      (top1.gmv / gmv.curr > 0.4 ? ' HEAVILY dependent on one host — key-person risk.' : ''));
  }

  // 6. Time slots — best + biggest shift
  if (report.timeSlots && report.timeSlots.length) {
    const best = [...report.timeSlots].sort((a, b) => (b.avgGmv ?? 0) - (a.avgGmv ?? 0))[0];
    const worst = [...report.timeSlots].sort((a, b) => (a.dAvgGmv ?? 0) - (b.dAvgGmv ?? 0))[0];
    F.push(`TIME SLOT: best = ${best.slot} (RM ${rm(best.avgGmv)} avg/slot, ${sl(best.dAvgGmv)}). ` +
      `Weakest shift = ${worst.slot} (${sl(worst.dAvgGmv)} per-slot).`);
  }

  // 7. Momentum — hosts with enough slots to trust
  if (report.hosts && report.hosts.length) {
    const rel = report.hosts.filter(h => h.slots >= 3 && h.dAvgGmv != null);
    if (rel.length >= 2) {
      const up = [...rel].sort((a, b) => b.dAvgGmv - a.dAvgGmv)[0];
      const down = [...rel].sort((a, b) => a.dAvgGmv - b.dAvgGmv)[0];
      F.push(`MOMENTUM (hosts with ≥3 slots): rising ${up.host} ${sl(up.dAvgGmv)} per-slot; ` +
        `falling ${down.host} ${sl(down.dAvgGmv)} per-slot.`);
    }
  }

  return F;
}

const DEFAULT_SYS = `You are a sharp TikTok livestream data analyst for a Malaysian brand. You write like a friendly human analyst, NOT a spreadsheet.

You receive PRE-COMPUTED FINDINGS (authoritative) plus the raw numbers behind them. The findings are already correct — they were calculated exactly, not estimated.

YOUR ONLY JOB: turn each finding into one short, natural sentence for a human reader.
- NEVER recompute, re-estimate, or invent a number. Use ONLY the figures given.
- If a finding says the gap is 7.6pp, write "7.6pp" — do not round it differently or derive a new number.
- Short sentences (~18 words). One idea per sentence. Lead with the conclusion, then the number.
- Bold ONLY the one key number per sentence with **double asterisks**. Max 1-2 bold per line.
- Say direction in words: "up X%" / "down X%", never "+X" alone.
- Small moves (under ~5%) = normal, say so briefly.

WHAT TO COVER (use the findings, in this order):
Overall — 3-4 bullets. The efficiency gap/the story, then RM attribution (who drove the change), then funnel (where it broke), then severity.
Hosts — top 3 performers with WHY (one line each), then the worst or a mid cluster with WHY. Cite per-slot change, not just GMV.
Best Time Slot — 1 line: which slot won and the weakest shift.
Observation & Suggestions — 2-3 concrete next actions, one line each, based on the findings (concentration risk, funnel bottleneck, momentum).

Format: section heading alone on its own line, then bullets. Plain natural English. No preamble, no filler.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { report } = req.body || {};
    if (!report || !report.overall) return res.status(400).json({ error: 'report required' });

    const apiKey = process.env.OPENAI_API_KEY || '';
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';

    const n2 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const pct = (d) => d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(1) + '%';

    const findings = computeFindings(report);

    // Raw numbers kept short — the model phrases, it does not calculate
    const digest = [
      `Period: ${report.currentMonthLabel} vs ${report.prevMonthLabel}`,
      `PRE-COMPUTED FINDINGS (authoritative — do not recompute):`,
      ...findings.map(f => `  * ${f}`),
      ``,
      `RAW NUMBERS (for reference only):`,
      ...report.overall.map(m => `  - ${m.metric} ${n2(m.curr)} | prev ${n2(m.prev)} | ${pct(m.delta)}`),
      `  HOSTS:`,
      ...report.hosts.slice(0, 10).map(h =>
        `    ${h.host}: GMV ${n2(h.gmv)} (prev ${n2(h.prevGmv)}, ${pct(h.dGmv)}) | slots ${h.slots} (prev ${h.prevSlots ?? '—'}, ${pct(h.dSlots)}) | avg/slot ${n2(h.avgGmv)} (${pct(h.dAvgGmv)})`
      ),
      `  TIME SLOTS:`,
      ...report.timeSlots.map(t =>
        `    ${t.slot}: avg/slot ${n2(t.avgGmv)} (${pct(t.dAvgGmv)}) | slots ${t.slots}`
      )
    ].join('\n');

    let insights;
    if (apiKey) {
      const callLLM = (temp) => fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'cohere/north-mini-code:free',
          messages: [{ role: 'system', content: DEFAULT_SYS }, { role: 'user', content: digest }],
          max_tokens: 1500, temperature: temp, reasoning: { exclude: true }
        })
      }).then(r => r.json().then(d => ({ ok: r.ok, d })));
      let { ok, d } = await callLLM(0.4);
      if (ok && d.choices?.[0]?.message?.content) insights = d.choices[0].message.content.trim();
      else if (ok) { const r2 = await callLLM(0.3); if (r2.ok && r2.d.choices?.[0]?.message?.content) insights = r2.d.choices[0].message.content.trim(); }
    }

    if (!insights) {
      // Fallback: rule-based — reuse the deterministic findings (no LLM at all)
      insights = findings.length
        ? findings.map(f => '• ' + f.replace(/^[A-Z ]+: /, '')).join('\n')
        : '• Insufficient data for analysis.';
    }

    return res.status(200).json({ insights });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}