// LES Dashboard — dashboard.js (redesigned)

const CARD_KEYS   = ['aug_matrix','rank','sol_type','final_answer'];
const CARD_LABELS = { aug_matrix:'Aug. Matrix', rank:'Rank', sol_type:'Sol. Type', final_answer:'Final Ans.' };
const CARD_COLORS = { aug_matrix:'#a78bfa', rank:'#22d3ee', sol_type:'#34d399', final_answer:'#f472b6' };
const SOL_LABELS  = { unique:'Unique', infinite:'Infinite', none:'No Solution' };

let history = [];
let username = 'Student';
const charts = {};

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadUser();
  await loadHistory();
  nav('home');
});

async function loadUser() {
  try {
    const d = await (await fetch('/api/auth/status')).json();
    if (d.logged_in) {
      username = d.username;
      const ini = d.username.slice(0,2).toUpperCase();
      el('sb-av').textContent   = ini;
      el('sb-name').textContent = d.username;
    }
  } catch(e) {}
}

async function loadHistory() {
  try {
    const d = await (await fetch('/api/dashboard/data')).json();
    history = Array.isArray(d) ? d : [];
  } catch(e) { history = []; }
}

// ── Navigation ────────────────────────────────────────────────
function nav(page) {
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  const navEl = el(`nav-${page}`);
  if (navEl) navEl.classList.add('active');
  Object.values(charts).forEach(c => c?.destroy());
  Object.keys(charts).forEach(k => delete charts[k]);
  const pages = { home:rHome, progress:rProgress, skills:rSkills, history:rHistory, strengths_weaknesses:rStrengthsWeaknesses, leaderboard:rLeaderboard };
  (pages[page] || rHome)(el('dc'));
}

function el(id) { return document.getElementById(id); }
function q(sel) { return document.querySelector(sel); }

// ── Metrics ───────────────────────────────────────────────────
function metrics() {
  const totals = history.map(a => a.total).filter(v => v != null);
  const best   = totals.length ? Math.max(...totals) : 0;
  const avg    = totals.length ? totals.reduce((a,b)=>a+b,0)/totals.length : 0;
  const totalHints = history.reduce((s,a) => s + Object.values(a.hint_counts||{}).reduce((x,v)=>x+v,0), 0);
  const cardAvgs = {}, firstTry = {}, hintPer = {};
  CARD_KEYS.forEach(k => {
    const vals = history.map(a=>a.scores?.[k]).filter(v=>v!=null);
    cardAvgs[k] = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    firstTry[k] = vals.length ? (history.filter(a=>a.scores?.[k]===5.0).length/vals.length)*100 : 0;
    hintPer[k]  = history.reduce((s,a)=>s+(a.hint_counts?.[k]||0),0);
  });
  const imp = totals.length>=2 ? totals[totals.length-1]-totals[0] : 0;
  let bestStreak=0, curStreak=0, hintFree=0;
  history.forEach(a => {
    const used = Object.values(a.hint_counts||{}).some(v=>v>0);
    curStreak = used ? 0 : curStreak+1;
    bestStreak = Math.max(bestStreak, curStreak);
  });
  for (let i=history.length-1;i>=0;i--) {
    if (Object.values(history[i].hint_counts||{}).some(v=>v>0)) break;
    hintFree++;
  }
  const solMap = {};
  history.forEach(a => { if(a.sol_type) { solMap[a.sol_type]=solMap[a.sol_type]||[]; solMap[a.sol_type].push(a.total); }});
  const solAvg = {};
  Object.entries(solMap).forEach(([t,vals])=>{ solAvg[t]=vals.reduce((a,b)=>a+b,0)/vals.length; });
  return { totals, best, avg, totalHints, cardAvgs, firstTry, hintPer, imp, bestStreak, hintFree, solAvg };
}

// ── Shared components ─────────────────────────────────────────
function chip(cls, label, val, sub='') {
  return `<div class="chip ${cls}"><div class="chip-label">${label}</div><div class="chip-val">${val}</div>${sub?`<div class="chip-sub">${sub}</div>`:''}</div>`;
}
function skillBars(m) {
  return CARD_KEYS.map(k => {
    const v=m.cardAvgs[k], pct=(v/5)*100;
    const col = v>=4?'var(--green)':v>=2.5?'var(--amber)':'var(--red)';
    return `<div class="sk-row"><div class="sk-top"><span class="sk-name">${CARD_LABELS[k]}</span><span class="sk-score">${v.toFixed(1)}/5</span></div><div class="sk-track"><div class="sk-fill" style="width:${pct}%;background:${col}"></div></div></div>`;
  }).join('');
}
function scoreBadge(s) {
  const cls = s>=15?'bd-g':s>=10?'bd-a':'bd-r';
  return `<span class="bd ${cls}">${s.toFixed(1)}/20</span>`;
}
function solBadge(t) {
  if (!t) return '—';
  const cls = t==='unique'?'sol-u':t==='infinite'?'sol-i':'sol-n';
  return `<span class="bd ${cls}">${SOL_LABELS[t]||t}</span>`;
}
function chartOpts(yMax=20) {
  return {
    responsive:true,
    plugins:{ legend:{display:false}, tooltip:{titleFont:{family:'DM Mono'},bodyFont:{family:'DM Mono'}} },
    scales:{
      x:{ grid:{display:false}, ticks:{color:'#7c3aed',font:{family:'DM Mono',size:10}} },
      y:{ min:0, max:yMax, grid:{color:'rgba(0,0,0,0.06)'}, ticks:{color:'#7c3aed',font:{family:'DM Mono',size:10}} }
    }
  };
}
function emptyHTML() {
  return `<div class="empty"><div class="empty-icon">📐</div><div class="empty-title">No attempts yet</div><div class="empty-sub">Complete your first quiz to see stats here.</div><button class="btn-cta" onclick="window.location.href='/quiz'">Start a Quiz →</button></div>`;
}

// ── What to Practice recommendations ─────────────────────────
function practiceRecs(m) {
  const recs = [];
  // Weakest card
  const sorted = CARD_KEYS.slice().sort((a,b)=>m.cardAvgs[a]-m.cardAvgs[b]);
  const weak = sorted[0];
  if (m.cardAvgs[weak] < 4.5) {
    const tips = {
      aug_matrix:   { icon:'📋', desc:'Practice reading coefficient and constant columns carefully.' },
      rank:         { icon:'🔢', desc:'Try counting non-zero rows after row reduction.' },
      sol_type:     { icon:'🔀', desc:'Review rank conditions: rank(A) vs rank([A|b]) vs n.' },
      final_answer: { icon:'✏️', desc:'Work through back-substitution step by step.' },
    };
    const t = tips[weak];
    recs.push(`<div class="prac"><div class="prac-icon" style="background:var(--violet-d)">${t.icon}</div><div><div class="prac-title">Practice ${CARD_LABELS[weak]}</div><div class="prac-desc">${t.desc} Your avg: ${m.cardAvgs[weak].toFixed(1)}/5.</div></div><button class="prac-btn" onclick="window.location.href='/quiz'">Practice →</button></div>`);
  }
  // Hint dependency
  const hintCard = CARD_KEYS.slice().sort((a,b)=>m.hintPer[b]-m.hintPer[a])[0];
  if (m.hintPer[hintCard] >= 2) {
    recs.push(`<div class="prac"><div class="prac-icon" style="background:var(--amber-d)">💡</div><div><div class="prac-title">Go Hint-Free on ${CARD_LABELS[hintCard]}</div><div class="prac-desc">You've used ${m.hintPer[hintCard]} hints here. Try without — you'll earn full 5 points.</div></div><button class="prac-btn" onclick="window.location.href='/quiz'">Try it →</button></div>`);
  }
  // Encourage theory test
  recs.push(`<div class="prac"><div class="prac-icon" style="background:var(--cyan-d)">🧠</div><div><div class="prac-title">Test Your Theory Knowledge</div><div class="prac-desc">Try the MCQ theory test to reinforce the concepts behind what you're solving.</div></div><button class="prac-btn" onclick="window.location.href='/mcq'">Take Test →</button></div>`);
  return recs.join('');
}

// ── PAGE: Home ────────────────────────────────────────────────
function rHome(wrap) {
  const m = history.length ? metrics() : null;
  const first = username.charAt(0).toUpperCase() + username.slice(1);
  const recent = history.slice(-4).reverse();

  wrap.innerHTML = `
    <div class="hero">
      <div>
        <div class="hero-title">Hey, <em>${first}</em> 👋</div>
        <div class="hero-sub">
          ${m ? `You've solved <strong>${history.length}</strong> system${history.length>1?'s':''}. ${m.hintFree>0?`Hint-free streak: <strong>${m.hintFree}</strong>.`:'Try going hint-free this round!'}` : 'Take your first quiz to start tracking progress!'}
        </div>
        <button class="hero-btn" onclick="window.location.href='/quiz'">+ New Quiz</button>
      </div>
    </div>

    <div class="chips">
      ${chip('v','Attempts', history.length||'0')}
      ${chip('p','Best Score', m?m.best.toFixed(1):'—', '/20')}
      ${chip('c','Avg Score',  m?m.avg.toFixed(1):'—',  '/20')}
      ${chip('g','Hints Used', m?m.totalHints:'0')}
    </div>

    ${m ? `
    <div class="g2 mb">
      <div class="panel">
        <div class="ph">Score Trend</div>
        <div class="pb"><canvas id="cht-trend" height="110"></canvas></div>
      </div>
      <div class="panel">
        <div class="ph">Recent Attempts</div>
        <div style="overflow-x:auto">
          <table class="tbl">
            <thead><tr><th>Matrix</th><th>Type</th><th>Score</th></tr></thead>
            <tbody>${recent.map(a=>`<tr>
              <td style="font-family:var(--mono);font-size:.78rem">${a.n_eq??'?'}×${a.n_var??'?'}</td>
              <td>${solBadge(a.sol_type)}</td>
              <td>${scoreBadge(a.total??0)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="g2 mb">
      <div class="panel">
        <div class="ph">Skill Breakdown</div>
        <div class="pb">${skillBars(m)}</div>
      </div>
      <div class="panel">
        <div class="ph">What to Practice</div>
        <div class="pb" style="padding-top:12px">${practiceRecs(m)}</div>
      </div>
    </div>
    ` : ''}

    <div class="mcq-card">
      <div class="mcq-card-icon">🧠</div>
      <div>
        <div class="mcq-card-title">Theory Test — 5 MCQs</div>
        <div class="mcq-card-sub">Test your understanding of linear equation concepts: rank, solution types, Gaussian elimination and more. Randomized each time.</div>
      </div>
      <button class="btn-mcq" onclick="window.location.href='/mcq'">Take Test →</button>
    </div>

    <!-- QUICK REFERENCE MODULE -->
    <div style="margin-top: 32px;">
      <h3 style="font-family: var(--display); font-size: 1.1rem; font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;"><span>📖</span> Quick Reference</h3>
      <div class="qr-grid">
        <div class="qr-card">
          <div class="qr-title">Augmented Matrix</div>
          <div class="qr-rule"><span class="qr-icon">▸</span><span>Write coefficients of each variable in columns, constants in the last column.</span></div>
          <div class="qr-rule"><span class="qr-icon">▸</span><span>Missing var → coeff is <span class="qr-formula">0</span></span></div>
          <div class="qr-rule"><span class="qr-icon">▸</span><span>Form: <span class="qr-formula">[ A | b ]</span></span></div>
        </div>
        <div class="qr-card">
          <div class="qr-title">Rank via Gaussian Elimination</div>
          <div class="qr-rule"><span class="qr-icon">▸</span><span>Use row operations to reach REF.</span></div>
          <div class="qr-rule"><span class="qr-icon">▸</span><span>Count <strong>non-zero rows</strong> in REF = rank.</span></div>
          <div class="qr-rule"><span class="qr-icon">▸</span><span>Find rank(A) from left side, rank([A|b]) from full matrix.</span></div>
        </div>
        <div class="qr-card">
          <div class="qr-title">Rouché–Capelli Theorem</div>
          <div class="qr-rule" style="flex-direction:column;gap:5px;">
            <div><span class="qr-badge bd-r">No Solution</span><br><span class="qr-formula">rank(A) ≠ rank([A|b])</span></div>
            <div><span class="qr-badge bd-g">Unique Solution</span><br><span class="qr-formula">rank(A) = rank([A|b]) = n</span></div>
            <div><span class="qr-badge bd-a">Infinite Solutions</span><br><span class="qr-formula">rank(A) = rank([A|b]) &lt; n</span></div>
          </div>
        </div>
        <div class="qr-card">
          <div class="qr-title">Parametric Form</div>
          <div class="qr-rule"><span class="qr-icon">▸</span><span>Free variable = col without pivot (z).</span></div>
          <div class="qr-rule"><span class="qr-icon">▸</span><span>Express pivot vars as <span class="qr-formula">xᵢ = az + b</span></span></div>
          <div class="qr-rule"><span class="qr-icon">▸</span><span>Substitute <span class="qr-formula">z=0,1,-1</span> to verify.</span></div>
        </div>
      </div>
    </div>
  `;

  if (m) {
    const avg = Array(m.totals.length).fill(+m.avg.toFixed(2));
    charts['trend'] = new Chart(el('cht-trend'), {
      type:'line',
      data:{ labels:m.totals.map((_,i)=>`#${i+1}`), datasets:[
        { data:m.totals, borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,0.08)', fill:true, tension:.4, pointBackgroundColor:'#a78bfa', pointRadius:4 },
        { data:avg, borderColor:'#f472b6', borderDash:[6,3], fill:false, tension:0, pointRadius:0 }
      ]},
      options:chartOpts(20)
    });
  }
}

// ── PAGE: Progress ────────────────────────────────────────────
function rProgress(wrap) {
  if (!history.length) { wrap.innerHTML=emptyHTML(); return; }
  const m = metrics();
  const last = m.totals[m.totals.length-1]??0;
  const trend = m.totals.length>=2 ? (last>m.totals[m.totals.length-2]?'↑ Up':last<m.totals[m.totals.length-2]?'↓ Down':'→ Flat') : '—';
  const impSign = m.imp>=0?'+':'';
  wrap.innerHTML = `
    <div class="chips" style="margin-bottom:16px">
      ${chip('g','Improvement',impSign+m.imp.toFixed(1),'vs first attempt')}
      ${chip('v','Best Streak', m.bestStreak,'hint-free')}
      ${chip('p','Last Score',  last.toFixed(1),'/20')}
      ${chip('n','Trend',       trend)}
    </div>
    <div class="panel mb">
      <div class="ph">Score Progression</div>
      <div class="pb"><canvas id="cht-prog" height="100"></canvas></div>
    </div>
    <div class="panel mb">
      <div class="ph">Hint Usage Per Attempt</div>
      <div class="pb"><canvas id="cht-hints" height="80"></canvas></div>
    </div>`;

  charts['prog'] = new Chart(el('cht-prog'),{type:'line',data:{labels:m.totals.map((_,i)=>`#${i+1}`),datasets:[{data:m.totals,borderColor:'#34d399',backgroundColor:'rgba(52,211,153,0.08)',fill:true,tension:.4,pointBackgroundColor:'#34d399',pointRadius:4}]},options:chartOpts(20)});
  const hpa = history.map(a=>Object.values(a.hint_counts||{}).reduce((s,v)=>s+v,0));
  charts['hints'] = new Chart(el('cht-hints'),{type:'bar',data:{labels:history.map((_,i)=>`#${i+1}`),datasets:[{data:hpa,backgroundColor:'rgba(244,114,182,0.55)',borderRadius:5}]},options:chartOpts(Math.max(4,...hpa)+1)});
}

// ── PAGE: Skills ──────────────────────────────────────────────
function rSkills(wrap) {
  if (!history.length) { wrap.innerHTML=emptyHTML(); return; }
  const m = metrics();
  const solL = Object.keys(m.solAvg);
  const solV = solL.map(k=>+m.solAvg[k].toFixed(2));
  const solC = solL.map(k=>k==='unique'?'rgba(34,211,238,.6)':k==='infinite'?'rgba(167,139,250,.6)':'rgba(248,113,113,.6)');
  wrap.innerHTML = `
    <div class="panel mb">
      <div class="ph">Avg Score vs Hint Usage Per Card</div>
      <div class="pb"><canvas id="cht-grouped" height="110"></canvas></div>
    </div>
    <div class="g2 mb">
      <div class="panel">
        <div class="ph">By Solution Type</div>
        <div class="pb"><canvas id="cht-sol" height="130"></canvas></div>
      </div>
      <div class="panel">
        <div class="ph">Skill Radar</div>
        <div class="pb"><canvas id="cht-radar" height="130"></canvas></div>
      </div>
    </div>`;

  charts['grouped'] = new Chart(el('cht-grouped'),{type:'bar',data:{labels:CARD_KEYS.map(k=>CARD_LABELS[k]),datasets:[{label:'Avg Score',data:CARD_KEYS.map(k=>+m.cardAvgs[k].toFixed(2)),backgroundColor:'rgba(167,139,250,.6)',borderRadius:5},{label:'Hints Used',data:CARD_KEYS.map(k=>m.hintPer[k]),backgroundColor:'rgba(244,114,182,.45)',borderRadius:5}]},options:chartOpts(Math.max(5,...CARD_KEYS.map(k=>m.hintPer[k]))+1)});

  if (solL.length) {
    charts['sol'] = new Chart(el('cht-sol'),{type:'bar',data:{labels:solL.map(l=>SOL_LABELS[l]||l),datasets:[{data:solV,backgroundColor:solC,borderRadius:5}]},options:chartOpts(20)});
  }

  charts['radar'] = new Chart(el('cht-radar'),{type:'radar',data:{labels:CARD_KEYS.map(k=>CARD_LABELS[k]),datasets:[{data:CARD_KEYS.map(k=>m.cardAvgs[k]),backgroundColor:'rgba(139,92,246,.12)',borderColor:'#8b5cf6',pointBackgroundColor:'#8b5cf6',pointRadius:3}]},options:{plugins:{legend:{display:false}},scales:{r:{min:0,max:5,ticks:{color:'#7c3aed',stepSize:1,backdropColor:'transparent',font:{size:9}},grid:{color:'rgba(0,0,0,0.06)'},angleLines:{color:'rgba(0,0,0,0.06)'},pointLabels:{color:'#7c3aed',font:{size:10}}}}}});
}

// ── PAGE: History ─────────────────────────────────────────────
function rHistory(wrap) {
  if (!history.length) { wrap.innerHTML=emptyHTML(); return; }
  const m = metrics();
  const rows = history.map((a,i)=>{
    const s=a.total??0, hints=Object.values(a.hint_counts||{}).reduce((x,v)=>x+v,0);
    const isBest = s===m.best&&m.best>0;
    return `<tr><td style="font-family:var(--mono);font-size:.75rem;color:var(--muted)">${i+1}</td>
      <td style="font-family:var(--mono);font-size:.8rem">${a.n_eq??'?'}×${a.n_var??'?'}</td>
      <td>${solBadge(a.sol_type)}</td>
      <td>${scoreBadge(s)}${isBest?`<span class="bd bd-star">★ best</span>`:''}</td>
      <td style="font-family:var(--mono);font-size:.8rem;color:${hints>0?'var(--amber)':'var(--muted)'}">${hints}</td>
      <td style="font-size:.78rem;color:var(--muted)">${a.timestamp||'—'}</td></tr>`;
  }).join('');
  wrap.innerHTML = `<div class="panel" style="padding:0"><div class="ph">All Attempts <span class="ph-sub">${history.length} total</span></div><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>#</th><th>Matrix</th><th>Type</th><th>Score</th><th>Hints</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ── PAGE: Strengths & Weaknesses ──────────────────────────────
function rStrengthsWeaknesses(wrap) {
  if (!history.length) { wrap.innerHTML=emptyHTML(); return; }
  const m = metrics();
  const strong = CARD_KEYS.filter(k=>m.cardAvgs[k]>=4.0);
  const weak = CARD_KEYS.filter(k=>m.cardAvgs[k]<2.5||m.hintPer[k]>=3);
  
  const strongTags = strong.length ? strong.map(k=>`<span class="tag tag-g">✓ ${CARD_LABELS[k]}</span>`).join('') : `<span class="tag tag-g">Keep practising!</span>`;
  const neverHinted = CARD_KEYS.filter(k=>m.hintPer[k]===0);
  const strongIns = neverHinted.length ? `<div class="ins good">💡 You never needed a hint on <strong>${neverHinted.map(k=>CARD_LABELS[k]).join(', ')}</strong> — excellent!</div>` : '';

  let weakContent = '';
  if (!weak.length) {
    weakContent = `<div class="ins good">✅ No significant weaknesses detected. Keep it up!</div>`;
  } else {
    const weakTags = weak.map(k=>`<span class="tag tag-r">⚠ ${CARD_LABELS[k]}</span>`).join('');
    const tips = weak.map(k=>`<div class="ins bad">${m.hintPer[k]>=3?`You used hints on <strong>${CARD_LABELS[k]}</strong> ${m.hintPer[k]} times — review the theory.`:`Your avg on <strong>${CARD_LABELS[k]}</strong> is ${m.cardAvgs[k].toFixed(1)}/5 — more practice needed.`}</div>`).join('');
    weakContent = `<div class="tags">${weakTags}</div>${tips}`;
  }

  wrap.innerHTML = `
    <div class="g2 mb">
      <div class="panel">
        <div class="ph">Your Strengths</div>
        <div class="pb">
          <div class="tags">${strongTags}</div>
          ${strongIns}
          <div style="margin-top:20px;font-family:var(--display);font-size:.85rem;margin-bottom:10px;">First-Try Success Rate</div>
          <canvas id="cht-ft" height="160"></canvas>
        </div>
      </div>
      <div class="panel">
        <div class="ph">Areas for Improvement</div>
        <div class="pb">
          ${weakContent}
          <div style="margin-top:20px;font-family:var(--display);font-size:.85rem;margin-bottom:10px;">Hint Dependency Per Card</div>
          <canvas id="cht-hd" height="160"></canvas>
        </div>
      </div>
    </div>
  `;

  charts['ft'] = new Chart(el('cht-ft'),{type:'bar',data:{labels:CARD_KEYS.map(k=>CARD_LABELS[k]),datasets:[{data:CARD_KEYS.map(k=>+m.firstTry[k].toFixed(1)),backgroundColor:'rgba(52,211,153,.6)',borderRadius:5}]},options:chartOpts(100)});
  charts['hd'] = new Chart(el('cht-hd'),{type:'bar',data:{labels:CARD_KEYS.map(k=>CARD_LABELS[k]),datasets:[{data:CARD_KEYS.map(k=>m.hintPer[k]),backgroundColor:'rgba(248,113,113,.6)',borderRadius:5}]},options:chartOpts(Math.max(5,...CARD_KEYS.map(k=>m.hintPer[k]))+1)});
}

// ── PAGE: Leaderboard ─────────────────────────────────────────
async function rLeaderboard(wrap) {
  wrap.innerHTML = `
    <div class="panel" style="padding:0">
      <div class="ph">◉ Leaderboard <span class="ph-sub">min 3 attempts · ranked by score</span></div>
      <div class="lb-formula">Ranking Score = (avg × 0.7) + (best × 0.3)</div>
      <div id="lb-body" style="padding:28px;text-align:center;color:var(--muted);font-family:var(--mono);font-size:.82rem">Loading…</div>
    </div>`;

  try {
    const data = await (await fetch('/api/leaderboard')).json();
    const medals = ['🥇','🥈','🥉'];
    if (!data.length) {
      el('lb-body').innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted);font-family:var(--mono);font-size:.82rem">No qualifying entries yet.<br>Complete 3+ quizzes to appear here.</div>`;
      return;
    }
    const rows = data.map(e => {
      const rank = e.rank<=3 ? `<span style="font-size:1.05rem">${medals[e.rank-1]}</span>` : `<span class="bd" style="font-family:var(--mono);font-size:.75rem;color:var(--muted)">#${e.rank}</span>`;
      return `<tr class="${e.is_me?'lb-me':''}">
        <td style="text-align:center;width:44px">${rank}</td>
        <td class="${e.is_me?'lb-n':''}">${e.username}${e.is_me?'<span class="me-chip">you</span>':''}</td>
        <td><span class="bd ${e.ranking_score>=14?'bd-g':e.ranking_score>=10?'bd-a':'bd-r'}">${e.ranking_score}</span></td>
        <td style="font-family:var(--mono);font-size:.78rem;color:var(--muted)">${e.best}/20</td>
        <td style="font-family:var(--mono);font-size:.78rem;color:var(--muted)">${e.avg}/20</td>
        <td style="font-family:var(--mono);font-size:.78rem;text-align:center">${e.attempts}</td>
        <td style="font-family:var(--mono);font-size:.78rem;text-align:center;color:var(--green)">${e.hint_free}</td>
      </tr>`;
    }).join('');
    el('lb-body').outerHTML = `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Rank</th><th>Student</th><th>Score</th><th>Best</th><th>Avg</th><th>Attempts</th><th>Hint-Free</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch(e) {
    el('lb-body').innerHTML = `<span style="color:var(--red)">⚠ Failed to load leaderboard.</span>`;
  }
}
