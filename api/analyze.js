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
  const comm = g('comments'), aov = g('average price'), ctor = g('ctor'), ctr = g('average ctr'), fol = g('followers');
  const hasPrev = !!(gmv && gmv.prev);
  const gmvD = gmv && gmv.delta != null ? gmv.delta : null;
  const TH = 5; // pp threshold: within this, two deltas are "in line"

  const drivers = [
    ['Total Views', views], ['Product Clicks', clicks], ['Items Sold', sold],
    ['New Followers', fol], ['Comments', comm], ['Total Slots', slots]
  ].filter(([, m]) => m && m.delta != null);

  // 1. ANCHOR — GMV vs slots, the efficiency reframe (Akiem's core rule).
  // A driver that fell LESS than GMV actually OUTPERFORMED; the gap is the real story, not the raw drop.
  if (gmv && slots && gmvD != null && slots.delta != null) {
    const gap = gmvD - slots.delta;
    let read;
    if (Math.abs(gap) < TH) read = `slots and GMV moved together (gap ${gap.toFixed(1)}pp) — this was a volume move, not an efficiency move.`;
    else if (gap > 0) read = `slots fell harder than GMV (gap +${gap.toFixed(1)}pp) — GMV held better than volume, so per-slot value actually ROSE.`;
    else read = `GMV fell harder than slots (gap ${gap.toFixed(1)}pp) — each slot earned less; efficiency, not volume, is the problem.`;
    F.push(`ANCHOR: GMV ${sl(gmvD)} vs slots ${sl(slots.delta)}. Avg GMV/slot ${sl(perSlot && perSlot.delta)}. ${read}`);
  }

  // 1b. CASCADE — decompose the GMV move: how much is VOLUME (slot count) vs EFFICIENCY (per-slot value),
  // then name the driver that moved WITH GMV (the mechanism) and the one that broke away hardest (the cause).
  if (gmv && slots && gmvD != null && slots.delta != null && hasPrev) {
    const effPart = gmvD - slots.delta;       // the share NOT explained by slot count → per-slot
    const drv = drivers.filter(([n]) => n !== 'Total Slots');
    let mech = null, brk = null;
    if (drv.length) {
      const byFit = [...drv].sort((a, b) => Math.abs(a[1].delta - gmvD) - Math.abs(b[1].delta - gmvD));
      mech = byFit[0];
      brk = [...drv].sort((a, b) => Math.abs(b[1].delta - gmvD) - Math.abs(a[1].delta - gmvD))[0];
    }
    let s = `CASCADE: GMV moved ${sl(gmvD)}; slot count explains ${sl(slots.delta)} of that, the other ${effPart.toFixed(1)}pp is per-slot EFFICIENCY.`;
    if (mech) s += ` The driver tracking GMV closest is ${mech[0]} ${sl(mech[1].delta)} — that is the mechanism.`;
    if (brk && Math.abs(brk[1].delta - gmvD) >= TH) s += ` The one breaking away hardest is ${brk[0]} ${sl(brk[1].delta)} (${(brk[1].delta - gmvD) > 0 ? 'held up' : 'dragged'} ${Math.abs(brk[1].delta - gmvD).toFixed(1)}pp) — dig here on why.`;
    F.push(s);
  }

  // 2. ALIGNMENT — every driver vs the GMV line. Off-line drivers are where to dig.
  if (gmvD != null && drivers.length) {
    const scored = drivers.map(([name, m]) => ({ name, d: m.delta, gap: m.delta - gmvD }))
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    const off = scored.filter(x => Math.abs(x.gap) >= TH).slice(0, 3);
    if (off.length) {
      F.push(`ALIGNMENT: against GMV ${sl(gmvD)} — ` + off.map(x =>
        `${x.name} ${sl(x.d)} (${x.gap > 0 ? 'held up +' : 'dragged '}${x.gap.toFixed(1)}pp)`).join('; ') +
        `. These sit OFF the GMV line — that is where the cause is.`);
    } else {
      F.push(`ALIGNMENT: every driver tracks GMV within ${TH}pp — the whole livestream moved as one. A broad, system-wide shift, not one broken stage.`);
    }
  }

  // 3. HOSTS — main host is the anchor; is per-slot output consistent across the team?
  let mainHost = null;
  if (report.hosts && report.hosts.length && gmv && gmv.curr) {
    const byGmv = [...report.hosts].sort((a, b) => b.gmv - a.gmv);
    mainHost = byGmv[0];
    const rel = report.hosts.filter(h => h.slots >= 3);
    const bySlot = [...rel].sort((a, b) => b.avgGmv - a.avgGmv);
    const best = bySlot[0], worst = bySlot[bySlot.length - 1];
    const spread = (best && worst && worst.avgGmv > 0) ? ((best.avgGmv - worst.avgGmv) / worst.avgGmv) * 100 : 0;
    F.push(`HOSTS: ${mainHost.host} is the lead = ${Math.round((mainHost.gmv / gmv.curr) * 100)}% of GMV. ` +
      (spread > 100
        ? `Per-slot output is UNEVEN — ${best.host} RM ${rm(best.avgGmv)}/slot vs ${worst.host} RM ${rm(worst.avgGmv)}/slot (${spread.toFixed(0)}% spread).`
        : `Per-slot output is CONSISTENT — ${best.host} RM ${rm(best.avgGmv)}/slot vs ${worst.host} RM ${rm(worst.avgGmv)}/slot.`) +
      (spread <= 100 && Math.abs(gmvD ?? 0) > TH ? ` So the drop is NOT a host-consistency problem.` : ''));

    // 3b. HOST EFFICIENCY — do the hosts convert? LIVE CTR (clicks/views) and CTOR (orders/clicks),
    // weighted from raw totals. A host can hold GMV but leak at CTR/CTOR, or vice versa.
    const withConv = report.hosts.filter(h => h.ctrNum != null && h.ctorNum != null);
    if (withConv.length >= 2) {
      const bestCtr = [...withConv].sort((a, b) => b.ctrNum - a.ctrNum)[0];
      const bestCtor = [...withConv].sort((a, b) => b.ctorNum - a.ctorNum)[0];
      // host whose conversion moved hardest vs the rest — the lever inside the team
      const withDelta = withConv.filter(h => h.dCtr != null || h.dCtor != null);
      const dropping = [...withDelta].sort((a, b) => Math.min(a.dCtr ?? 0, a.dCtor ?? 0) - Math.min(b.dCtr ?? 0, b.dCtor ?? 0))[0];
      let s = `HOST CONVERSION: best LIVE CTR ${bestCtr.host} ${bestCtr.ctrNum.toFixed(1)}%${bestCtr.dCtr != null ? ` (${sl(bestCtr.dCtr)})` : ''}, ` +
        `best CTOR ${bestCtor.host} ${bestCtor.ctorNum.toFixed(2)}%${bestCtor.dCtor != null ? ` (${sl(bestCtor.dCtor)})` : ''}.`;
      if (dropping && Math.min(dropping.dCtr ?? 0, dropping.dCtor ?? 0) < -TH)
        s += ` Watch ${dropping.host} — conversion slipping (CTR ${sl(dropping.dCtr)}, CTOR ${sl(dropping.dCtor)}).`;
      F.push(s);
    }
  }

  // 4. BACKUPS — the non-lead hosts: who shows potential, who is dead weight.
  if (report.hosts && report.hosts.length) {
    const nonLead = [...report.hosts].sort((a, b) => b.gmv - a.gmv).slice(1)
      .filter(h => h.slots >= 3 && h.dAvgGmv != null);
    if (nonLead.length >= 2) {
      const rising = [...nonLead].sort((a, b) => b.dAvgGmv - a.dAvgGmv).filter(h => h.dAvgGmv > TH).slice(0, 2);
      const allAvg = nonLead.reduce((a, h) => a + h.avgGmv, 0) / nonLead.length;
      const weak = [...nonLead].sort((a, b) => a.dAvgGmv - b.dAvgGmv).filter(h => h.dAvgGmv < 0 && h.avgGmv < allAvg).slice(0, 2);
      let s = 'BACKUPS: ';
      s += rising.length ? `potential — ${rising.map(h => `${h.host} ${sl(h.dAvgGmv)}/slot`).join(', ')}. ` : `no riser (nobody up more than ${TH}%). `;
      s += weak.length ? `dead weight — ${weak.map(h => `${h.host} RM ${rm(h.avgGmv)}/slot ${sl(h.dAvgGmv)}`).join(', ')}.` : `no obvious dead weight.`;
      F.push(s);
    }
  }

  // 5. TIME SLOT — best by value + weakest by shift, and whether it is per-slot value or slot count that moved.
  if (report.timeSlots && report.timeSlots.length) {
    const best = [...report.timeSlots].sort((a, b) => (b.avgGmv ?? 0) - (a.avgGmv ?? 0))[0];
    const worst = [...report.timeSlots].sort((a, b) => (a.dAvgGmv ?? 0) - (b.dAvgGmv ?? 0))[0];
    const cnt = (t) => (t.prevSlots != null && t.slots != null && t.prevSlots > 0)
      ? ` (slots ${t.slots} vs ${t.prevSlots})` : '';
    if (best.slot === worst.slot) {
      F.push(`TIME SLOT: ${best.slot} is the top earner (RM ${rm(best.avgGmv)}/slot) yet also the sharpest fall ${sl(best.dAvgGmv)} per-slot${cnt(best)}. All shifts down.`);
    } else {
      F.push(`TIME SLOT: best = ${best.slot} (RM ${rm(best.avgGmv)}/slot, ${sl(best.dAvgGmv)}${cnt(best)}). ` +
        `Weakest = ${worst.slot} (${sl(worst.dAvgGmv)} per-slot${cnt(worst)}).`);
    }
  }

  // 6. SEVERITY + conversion rates (weighted) in one line
  if (gmv) F.push(`SEVERITY: GMV ${sl(gmvD)} = ${band(gmvD)} vs last month. Avg CTR ${sl(ctr && ctr.delta)}, CTOR ${sl(ctor && ctor.delta)}, followers ${sl(fol && fol.delta)}.`);

  // 7. PRODUCTS — the SKU tab is its own source; use ITS totals, never the Raw Data GMV.
  const P = (report.products || []).filter(p => p.gmv > 0);
  const sku = report.skuStats || null;
  if (P.length && sku && sku.total > 0) {
    const top = P[0];
    const withPrev = P.filter(p => p.gmvPrev > 0);
    const dPct = (p) => ((p.gmv - p.gmvPrev) / p.gmvPrev) * 100;
    const riser = [...withPrev].sort((a, b) => dPct(b) - dPct(a))[0];
    const faller = [...withPrev].sort((a, b) => dPct(a) - dPct(b))[0];
    const top10Share = (P.reduce((a, p) => a + p.gmv, 0) / sku.total) * 100;
    let s = `PRODUCTS (SKU tab): top seller ${top.name} = RM ${rm(top.gmv)} (${((top.gmv / sku.total) * 100).toFixed(0)}% of SKU GMV, ${top.sold} sold, GPM RM ${rm(top.gpm)}). ` +
      `Top ${P.length} = ${top10Share.toFixed(0)}% of SKU GMV.`;
    if (riser) s += ` Sharp riser ${riser.name} ${sl(dPct(riser))}.`;
    if (faller && faller.name !== top.name) s += ` Sharp faller ${faller.name} ${sl(dPct(faller))}.`;
    F.push(s);

    // RELATE the two tabs: SKU total Δ against the Raw Data (session) GMV Δ. Two sources, one story.
    if (sku.prev > 0 && gmvD != null) {
      const skuD = ((sku.total - sku.prev) / sku.prev) * 100;
      const gap = skuD - gmvD;
      F.push(`PRODUCT vs SESSION: SKU-tab GMV ${sl(skuD)} vs Raw-tab (session) GMV ${sl(gmvD)} — ` +
        `${Math.abs(gap) < TH ? 'both tabs agree, the drop is across every product' : (gap < 0 ? `products fell harder (${gap.toFixed(1)}pp) — the hit is concentrated at product level` : `sessions fell harder (${gap.toFixed(1)}pp) — the hit is in traffic/livestream, not the products`)}. ` +
        `SKU total RM ${rm(sku.total)} across ${sku.count} products (the two tabs track different things, so totals are not expected to match).`);
    }
  }

  // 7b. Product-level funnel (only when SKU data exists) — shelf impressions → clicks → sold
  const PP = (report.products || []).filter(p => p.gmv > 0);
  if (PP.length && hasPrev) {
    const sImp = PP.reduce((a, p) => a + p.impressions, 0), sClk = PP.reduce((a, p) => a + p.clicks, 0), sSold = PP.reduce((a, p) => a + p.sold, 0);
    const sImpP = PP.reduce((a, p) => a + p.impressionsPrev, 0), sClkP = PP.reduce((a, p) => a + p.clicksPrev, 0), sSoldP = PP.reduce((a, p) => a + p.soldPrev, 0);
    if (sImp && sClk && sImpP && sClkP) {
      const ctrC = (sClk / sImp) * 100, ctrP = (sClkP / sImpP) * 100;
      const cvrC = sClk ? (sSold / sClk) * 100 : 0, cvrP = sClkP ? (sSoldP / sClkP) * 100 : 0;
      const dCtr = ctrP ? ((ctrC - ctrP) / ctrP) * 100 : 0;
      const dCvr = cvrP ? ((cvrC - cvrP) / cvrP) * 100 : 0;
      const worst = Math.abs(dCtr) > Math.abs(dCvr) ? `shelf CTR ${sl(dCtr)}` : `click→sold ${sl(dCvr)}`;
      F.push(`PRODUCT FUNNEL (top products): impressions→clicks ${ctrC.toFixed(1)}% (${sl(dCtr)}), clicks→sold ${cvrC.toFixed(1)}% (${sl(dCvr)}). ` +
        `Weakest stage: ${worst}.`);
    }
  }

  return F;
}

// ── Supabase cache (firm per month-year) ──────────────────────────────────
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const sbOn = () => !!(SB_URL && SB_KEY);
async function sbGet(key) {
  const r = await fetch(`${SB_URL}/rest/v1/ai_insights?cache_key=eq.${encodeURIComponent(key)}&select=insights`, {
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.insights || null;
}
async function sbPut(key, account, period, insights) {
  await fetch(`${SB_URL}/rest/v1/ai_insights`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify([{ cache_key: key, account, period, insights }])
  });
}

// ── normalize LLM output to the exact ADHD-friendly shape ─────────────────
function shapeInsights(md) {
  if (!md) return md;
  const alias = {
    'overall': 'Overall', 'hosts': 'Hosts', 'host': 'Hosts',
    'best time slot': 'Best Time Slot', 'time slot': 'Best Time Slot', 'time slots': 'Best Time Slot',
    'top products': 'Top Products', 'top product': 'Top Products', 'products': 'Top Products', 'product': 'Top Products', 'best products': 'Top Products',
    'do this': 'Do This', 'observation & suggestions': 'Do This', 'observations & suggestions': 'Do This',
    'observation and suggestions': 'Do This', 'suggestions': 'Do This', 'takeaways': 'Do This'
  };
  const cap = { 'Overall': 3, 'Hosts': 3, 'Best Time Slot': 1, 'Top Products': 2, 'Do This': 2 };
  const order = ['Overall', 'Hosts', 'Best Time Slot', 'Top Products', 'Do This'];
  const sections = {};
  let cur = null;
  for (const raw of String(md).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const isBullet = /^[-*•]\s+/.test(line);
    if (!isBullet) {
      const norm = line.toLowerCase().replace(/[*#:]/g, '').trim();
      const mapped = alias[norm] || (norm.length < 30 ? norm.replace(/\b\w/g, c => c.toUpperCase()) : null);
      if (mapped && order.includes(mapped)) { cur = mapped; sections[cur] = sections[cur] || []; continue; }
      // unknown non-bullet heading: treat as continuation only if we already have a section
      if (cur) { sections[cur].push(line.replace(/^[-*•]\s+/, '')); continue; }
      continue;
    }
    const text = line.replace(/^[-*•]\s+/, '');
    const target = cur || 'Overall';
    sections[target] = sections[target] || [];
    sections[target].push(text);
  }
  const out = [];
  for (const name of order) {
    const items = (sections[name] || []).slice(0, cap[name]).map(scrub);
    if (!items.length) continue;
    out.push(name);
    items.forEach(t => out.push('- ' + t));
    out.push('');
  }
  return out.join('\n').trim() || md;
}

// ponytail: the narrator is told a banned list but won't obey 100%. Scrub the tells it slips
// through. A word swap / em-dash strip is enough — no need to rewrite whole sentences.
const BANNED_RE = /\b(delve|delving|crucial|pivotal|vital|robust|leverage|leveraging|seamless|holistic|landscape|testament|underscore|underscores|underscoring|showcase|showcasing|foster|fostering|elevate|navigate|unpack|game-changer|ultimately|essentially)\b/gi;
const PHRASES = [
  [/\bit'?s worth noting that\b/gi, ''], [/\bit is worth noting that\b/gi, ''],
  [/\bat the end of the day,?\s*/gi, ''], [/\bin today'?s (?:world|landscape),?\s*/gi, ''],
  [/\blet'?s (?:dive in|look at|explore|break this down)\.?\s*/gi, ''],
  [/\bhere'?s what you need to know\.?\s*/gi, ''],
  [/\ba testament to\b/gi, ''], [/\bis a testament to\b/gi, 'shows'],
];
function scrub(s) {
  let t = String(s);
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  t = t.replace(BANNED_RE, (m) => {
    const map = { delve:'dig', crucial:'key', pivotal:'key', vital:'key', robust:'strong', leverage:'use', leveraging:'using', seamless:'smooth', holistic:'full', landscape:'picture', testament:'proof', underscore:'show', underscores:'shows', underscoring:'showing', showcase:'show', showcasing:'showing', foster:'drive', fostering:'driving', elevate:'lift', navigate:'handle', unpack:'explain', 'game-changer':'big change', ultimately:'', essentially:'' };
    return map[m.toLowerCase()] ?? m;
  });
  t = t.replace(/\s*[—–]\s*/g, ', ');   // em/en dash → comma (humanizer pattern 14); full stop made fragments
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/,\s*,/g, ',').replace(/\.\s*\./g, '.').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const DEFAULT_SYS = `You are a sharp TikTok livestream analyst for a Malaysian brand. Your reader has ADHD: they want the point in one glance, no digging.

You receive PRE-COMPUTED FINDINGS (authoritative) plus the raw numbers. The findings are already exact. Never recompute, re-estimate, or invent a number. Use only the figures given.

MENTAL MODEL — it is all one connected math. GMV is the anchor. Slots, views, clicks, followers, comments and items sold should move roughly in line with it. Where a driver sits OFF the GMV line is the interesting part: say whether it OUTPERFORMED (fell less) or DRAGGED (fell more). Then is it a VOLUME move (slots changed) or an EFFICIENCY move (per-slot value changed)? Then hosts, then products. Always judge a move relative to the anchor, never in isolation.

HOW TO WRITE
- One idea per line. Under 14 words. If it runs long, cut it.
- Shape every line as WHAT the number is, then SO WHAT it means. Number first, consequence second. "Morning still earns RM2,107 a slot, but it fell 26% so the buffer is gone."
- Give the number, not a vibe. "Sessions slipped 2.7%" beats "sessions were soft".
- Have an opinion. Name the dead weight, name the fix, say plainly whether a number is good or bad. Never report neutrally.
- Bold max ONE key number per line with **double asterisks**. Never bold a whole phrase.
- Say direction in words: "down 4%", "up 4%". Never "+10%" alone.
- Small moves (under ~5%) get one short clause, no drama.

BANNED. These make it read like a machine wrote it. Never use: delve, crucial, pivotal, vital, robust, leverage, seamless, holistic, landscape, testament, underscore, showcase, foster, elevate, navigate, unpack, deep dive, game-changer, at the end of the day, it's worth noting, ultimately, essentially, in today's world.
- No em dashes. Use a full stop or a colon.
- No rule-of-three padding ("faster, smarter, better").
- No "not just X, but Y".
- No signposting ("Let's look at..."). No preamble, no closing line.
- No generic upbeat ending. End on the last fact.

STRUCTURE — output EXACTLY these headings, in this order, nothing else (Top Products only when product findings exist):
Overall
- exactly 3 bullets. 1) ANCHOR: GMV vs slots, volume or efficiency move, and whether a smaller fall means per-slot value actually rose. 2) ALIGNMENT: which drivers sit off the GMV line (held up / dragged), or that everything moved as one. 3) SEVERITY, plus CTR/CTOR/followers in one line.
Hosts
- exactly 3 bullets, max 14 words each. 1) Lead host share, and whether per-slot output across the team is consistent or uneven. 2) Conversion: best LIVE CTR and best CTOR among hosts. 3) BACKUPS: who shows potential, who is dead weight.
Best Time Slot
- exactly 1 bullet. Winner by value and the weakest shift, plus whether the slot count changed.
Top Products
- exactly 2 bullets, max 14 words each. 1) Top seller share within the SKU tab's OWN GMV, and whether products and sessions moved together or apart. 2) Sharp riser and sharp faller. Skip the heading if there are no product findings. The SKU tab and the Raw Data tab are SEPARATE sources; never imply their totals should match.
Do This
- exactly 2 bullets, max 12 words each. Each starts with a verb and names a concrete action (who or what to change), not a platitude.

Bullets start with "- ". Plain natural English.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { report, cacheKey, force } = req.body || {};
    if (!report || !report.overall) return res.status(400).json({ error: 'report required' });

    const key = cacheKey || `${report.currentMonthLabel}|${report.title || ''}`;

    // Cache-first: return the stored analysis for this month (firm), unless force-regenerate
    if (sbOn() && !force) {
      const hit = await sbGet(key);
      if (hit) return res.status(200).json({ insights: hit, cached: true });
    }

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
        `    ${h.host}: GMV ${n2(h.gmv)} (prev ${n2(h.prevGmv)}, ${pct(h.dGmv)}) | slots ${h.slots} (prev ${h.prevSlots ?? '—'}, ${pct(h.dSlots)}) | avg/slot ${n2(h.avgGmv)} (${pct(h.dAvgGmv)}) | LIVE CTR ${h.ctrNum != null ? h.ctrNum.toFixed(2) + '%' : '—'} (${pct(h.dCtr)}) | CTOR ${h.ctorNum != null ? h.ctorNum.toFixed(2) + '%' : '—'} (${pct(h.dCtor)})`
      ),
      `  TIME SLOTS:`,
      ...report.timeSlots.map(t =>
        `    ${t.slot}: avg/slot ${n2(t.avgGmv)} (${pct(t.dAvgGmv)}) | slots ${t.slots}`
      ),
      ...((report.products && report.products.length) ? [
        `  TOP PRODUCTS (SKU tab — its own source, do NOT compare its total to the Raw Data GMV):`,
        ...(report.skuStats ? [`    SKU total RM ${n2(report.skuStats.total)} vs prev RM ${n2(report.skuStats.prev)} across ${report.skuStats.count} products`] : []),
        ...report.products.slice(0, 10).map(p =>
          `    ${p.name}: GMV ${n2(p.gmv)} (prev ${n2(p.gmvPrev)}, ${p.gmvPrev > 0 ? pct(((p.gmv - p.gmvPrev) / p.gmvPrev) * 100) : 'new'}) | sold ${p.sold} | AOV ${n2(p.aov)} | GPM ${n2(p.gpm)} | imp ${p.impressions} | clicks ${p.clicks}`
        )
      ] : [])
    ].join('\n');

    let insights;
    if (apiKey) {
      const callLLM = (temp) => fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: process.env.AI_MODEL || 'cohere/north-mini-code:free',
          messages: [{ role: 'system', content: DEFAULT_SYS }, { role: 'user', content: digest }],
          max_tokens: 4000, temperature: temp, reasoning: { max_tokens: 700 }
        })
      }).then(r => r.json().then(d => ({ ok: r.ok, d })));
      let { ok, d } = await callLLM(0.4);
      if (ok && d.choices?.[0]?.message?.content) insights = shapeInsights(d.choices[0].message.content.trim());
      else if (ok) { const r2 = await callLLM(0.3); if (r2.ok && r2.d.choices?.[0]?.message?.content) insights = shapeInsights(r2.d.choices[0].message.content.trim()); }
    }

    if (!insights) {
      // Fallback: rule-based — reuse the deterministic findings (no LLM at all)
      insights = findings.length
        ? findings.map(f => '• ' + f.replace(/^[A-Z ]+: /, '')).join('\n')
        : '• Insufficient data for analysis.';
    }

    // Persist for this month-year so the analysis stays firm (only LLM output, not fallback)
    if (sbOn() && insights && !insights.startsWith('•')) {
      try { await sbPut(key, report.title || '', report.currentMonthLabel || '', insights); } catch (e) { /* cache write is best-effort */ }
    }

    return res.status(200).json({ insights });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}