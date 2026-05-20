// -- State ----------------------------------------------------
const state = {
  currentCard: 1,
  totalCards: 7,
  nEq: 0,
  nVar: 0,
  solType: null,
  scores: {},
  quizAttempts: { q3: 0, q4: 0, q5: 0, q6: 0 },
  quizLocked:   { q3: false, q4: false, q5: false, q6: false },
  hintUsed:     { q3: false, q4: false, q5: false, q6: false },
};

// Issue #8: Map frontend qKeys to backend score keys
const QUIZ_KEY_MAP = {
  q3: 'aug_matrix',
  q4: 'rank',
  q5: 'sol_type',
  q6: 'final_answer',
};

const MAX_RETRIES = 1;

// ── Utilities ────────────────────────────────────────────────
function subscript(n) {
  const sub = '₀₁₂₃₄₅₆₇₈₉';
  return String(n).split('').map(d => sub[parseInt(d)]).join('');
}
function varLabel(i) { return 'x' + subscript(i + 1); }

async function apiFetch(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

function showFeedback(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = msg;
  el.className = `feedback-box ${type}`;
  el.style.display = 'block';
}

// ── Score Badge ───────────────────────────────────────────────
function refreshScoreBadge() {
  const badge = document.getElementById('score-badge');
  badge.style.visibility = 'visible';
  const total = Object.values(state.scores).reduce((a, b) => a + b, 0);
  document.getElementById('live-score').textContent = total.toFixed(1);
  badge.classList.remove('badge-flash');
  void badge.offsetWidth;
  badge.classList.add('badge-flash');
}

// ── Retries display ───────────────────────────────────────────
function updateRetriesDisplay(qKey) {
  const el = document.getElementById(`${qKey}-retries`);
  if (!el) return;
  if (state.quizLocked[qKey]) {
    el.textContent = 'Completed ✓';
    el.className = 'quiz-retries retries-done';
    return;
  }
  const attempts = state.quizAttempts[qKey];
  if (attempts === 0) {
    el.textContent = '1 retry available';
    el.className = 'quiz-retries';
  } else if (attempts === 1) {
    el.textContent = '1 retry left';
    el.className = 'quiz-retries retries-warn';
  } else {
    el.textContent = '';
    el.className = 'quiz-retries';
  }
}

// ── Retry Button ──────────────────────────────────────────────
function showRetryButton(qKey, onRetry) {
  const old = document.getElementById(`${qKey}-retry-btn`);
  if (old) old.remove();
  const retriesUsed = state.quizAttempts[qKey] - 1;
  if (retriesUsed >= MAX_RETRIES) return;
  const actions   = document.getElementById(`${qKey}-actions`);
  const submitBtn = document.getElementById(`${qKey}-submit-btn`);
  const btn = document.createElement('button');
  btn.id        = `${qKey}-retry-btn`;
  btn.className = 'btn btn-retry';
  btn.textContent = '↺ Retry';
  btn.onclick = onRetry;
  actions.insertBefore(btn, submitBtn);
}

function hideRetryButton(qKey) {
  document.getElementById(`${qKey}-retry-btn`)?.remove();
}

// ── Confirmation Modal ────────────────────────────────────────
function showConfirmModal(title, bodyHtml, onConfirm) {
  document.getElementById('confirm-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'confirm-modal';
  modal.innerHTML = `
    <div class="hint-overlay">
      <div class="hint-box">
        <div class="hint-box-header"><span class="hint-icon">📋</span><span>${title}</span></div>
        <div class="hint-box-body">${bodyHtml}</div>
        <div class="hint-box-actions">
          <button class="btn btn-secondary" onclick="closeConfirmModal()">← Edit Answers</button>
          <button class="btn btn-primary" id="confirm-yes-btn">Submit ✓</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('confirm-yes-btn').addEventListener('click', () => {
    closeConfirmModal();
    onConfirm();
  });
}
function closeConfirmModal() { document.getElementById('confirm-modal')?.remove(); }

// ── Navigation ────────────────────────────────────────────────
function goCard(n) {
  document.getElementById(`card-${state.currentCard}`).classList.remove('active');
  state.currentCard = n;
  document.getElementById(`card-${n}`).classList.add('active');
  const pct = ((n - 1) / (state.totalCards - 1)) * 100;
  document.getElementById('progress-bar').style.width = pct + '%';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Inline error helper ───────────────────────────────────────
function showInlineError(containerId, msg) {
  let el = document.getElementById(containerId + '-err');
  if (!el) {
    el = document.createElement('p');
    el.id        = containerId + '-err';
    el.className = 'inline-error';
    const ref = document.querySelector(`#${containerId} .card-actions`);
    ref?.parentNode.insertBefore(el, ref);
  }
  el.innerHTML    = '⚠️ ' + msg;
  el.style.display = 'block';
}
function hideInlineError(containerId) {
  document.getElementById(containerId + '-err')?.remove();
}

// ── Card 1: Configure ─────────────────────────────────────────
async function configureMatrix() {
  const nEqRaw  = document.getElementById('n-eq').value.trim();
  const nVarRaw = document.getElementById('n-var').value.trim();
  if (!nEqRaw || !nVarRaw) { showInlineError('card-1', 'Please fill in both fields.'); return; }
  const nEq = parseInt(nEqRaw), nVar = parseInt(nVarRaw);
  if (isNaN(nEq) || isNaN(nVar)) { showInlineError('card-1', 'Only whole numbers allowed (e.g. 2, 3).'); return; }
  if (nEq < 2 || nVar < 2)       { showInlineError('card-1', 'Values must be at least 2.'); return; }
  if (nEq > 5 || nVar > 5)       { showInlineError('card-1', 'Maximum size is 5 × 5.'); return; }

  if (nEq !== nVar) {
    const msg = nEq > nVar
      ? `You have <strong>${nEq} equations</strong> but only <strong>${nVar} variables</strong> — over-determined system. May have no solution or a unique solution.`
      : `You have <strong>${nEq} equations</strong> and <strong>${nVar} variables</strong> — under-determined system. Likely has infinite solutions.`;
    showConfirmModal('⚠️ Non-Square Matrix',
      `<p class="hint-explain">${msg}</p><p class="hint-explain">Do you want to continue anyway?</p>`,
      () => doConfigureMatrix(nEq, nVar));
  } else {
    hideInlineError('card-1');
    await doConfigureMatrix(nEq, nVar);
  }
}

async function doConfigureMatrix(nEq, nVar) {
  const data = await apiFetch('/api/set_config', 'POST', { equations: nEq, variables: nVar });
  if (!data.ok) { showInlineError('card-1', data.error); return; }
  state.nEq = nEq; state.nVar = nVar;
  hideInlineError('card-1');
  buildEquationTable();
  goCard(2);
}

// ── Card 2: Equation Table ────────────────────────────────────
function buildEquationTable() {
  const wrap = document.getElementById('eq-table-wrap');
  const { nEq, nVar } = state;
  let html = '<table class="eq-table"><tbody>';
  for (let i = 0; i < nEq; i++) {
    html += '<tr>';
    for (let j = 0; j < nVar; j++) {
      if (j > 0) html += '<td class="eq-op" style="padding: 0 8px;">+</td>';
      html += `<td><input type="text" inputmode="decimal" pattern="[-.0-9]*" class="num-input eq-input"
                id="eq-${i}-${j}" aria-label="Equation ${i+1} coefficient for ${varLabel(j)}" placeholder="e.g. ${i + j > 0 ? i + j : 2}"
                autocomplete="off"/></td>`;
      // Issue #12: Use --text-muted (not --text-mut)
      html += `<td class="eq-var-mult" style="padding: 0 4px; color: var(--text-muted);">×</td>`;
      html += `<td class="eq-var-label" style="font-weight: 600; font-size: 1.1em; color: var(--blue);">${varLabel(j)}</td>`;
    }
    html += `<td class="eq-sep" style="padding: 0 10px;">=</td>
             <td><input type="text" inputmode="decimal" pattern="[-.0-9]*" class="num-input eq-input"
                  id="eq-${i}-b" aria-label="Equation ${i+1} constant" placeholder="e.g. ${(i + 1) * 2}"
                  autocomplete="off"/></td></tr>`;
  }
  html += '</tbody></table>';
  html += '<p class="hint-text" style="margin-top:10px">💡 Use decimals like <strong>1.5</strong> or negatives like <strong>-3</strong>. Press <strong>Enter</strong> to move between boxes.</p>';
  html += '<div class="feedback-box" id="eq-error" style="display:none"></div>';
  wrap.innerHTML = html;

  const inputs = Array.from(wrap.querySelectorAll('.eq-input'));
  inputs.forEach((inp, idx) => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); idx + 1 < inputs.length ? inputs[idx + 1].focus() : submitEquations(); }
    });
  });
  inputs[0]?.focus();
}

async function submitEquations() {
  const { nEq, nVar } = state;
  const coeffs = [];
  for (let i = 0; i < nEq; i++) {
    const row = [];
    for (let j = 0; j <= nVar; j++) {
      const id  = j < nVar ? `eq-${i}-${j}` : `eq-${i}-b`;
      const inp = document.getElementById(id);
      if (inp.value.trim() === '') {
        inp.classList.add('wrong'); inp.focus();
        showFeedback('eq-error', `⚠️ Row ${i + 1} has an empty field. Please fill all boxes.`, 'error');
        return;
      }
      const num = parseFloat(inp.value);
      if (isNaN(num)) {
        inp.classList.add('wrong'); inp.focus();
        showFeedback('eq-error', `⚠️ "${inp.value}" is not valid. Use numbers like 2, -1, or 0.5.`, 'error');
        return;
      }
      inp.classList.remove('wrong');
      row.push(num);
    }
    coeffs.push(row);
  }
  const data = await apiFetch('/api/set_equations', 'POST', { coefficients: coeffs });
  if (!data.ok) { showFeedback('eq-error', '⚠️ ' + data.error, 'error'); return; }
  state.solType = data.sol_type;
  buildAugMatrix();
  goCard(3);
}

// ── Card 3: Augmented Matrix Quiz ─────────────────────────────
function buildAugMatrix() {
  const { nEq, nVar } = state;
  const wrap = document.getElementById('aug-matrix-wrap');
  let html = '<div class="aug-matrix-wrap">';
  for (let i = 0; i < nEq; i++) {
    html += '<div class="aug-row"><span class="aug-bracket-left"></span>';
    for (let j = 0; j < nVar; j++) {
      html += `<input type="text" inputmode="decimal" pattern="[-.0-9]*" class="num-input aug-input"
                 id="aug-${i}-${j}" aria-label="Augmented matrix row ${i+1} column ${j+1}" placeholder="a${i + 1}${j + 1}" autocomplete="off"/>`;
    }
    html += '<div class="aug-sep"></div>';
    html += `<input type="text" inputmode="decimal" pattern="[-.0-9]*" class="num-input aug-input"
               id="aug-${i}-b" aria-label="Augmented matrix row ${i+1} constant" placeholder="b${i + 1}" autocomplete="off"/>`;
    html += '<span class="aug-bracket-right"></span></div>';
  }
  html += '</div>';
  wrap.innerHTML = html;
  const inputs = Array.from(wrap.querySelectorAll('.aug-input'));
  inputs.forEach((inp, idx) => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); idx + 1 < inputs.length ? inputs[idx + 1].focus() : document.getElementById('q3-submit-btn')?.focus(); }
    });
  });
  inputs[0]?.focus();
  updateRetriesDisplay('q3');
}

async function doSubmitAugMatrix() {
  if (state.quizLocked.q3) return;
  const { nEq, nVar } = state;
  state.quizAttempts.q3++;
  const submitBtn = document.getElementById('q3-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Checking…'; }

  const matrix = [];
  for (let i = 0; i < nEq; i++) {
    const row = [];
    for (let j = 0; j <= nVar; j++) {
      const id = j < nVar ? `aug-${i}-${j}` : `aug-${i}-b`;
      const v  = parseFloat(document.getElementById(id).value);
      row.push(isNaN(v) ? '' : v);
    }
    matrix.push(row);
  }

  const data = await apiFetch('/api/quiz/augmented_matrix', 'POST',
    { matrix, attempt: state.quizAttempts.q3, used_hint: state.hintUsed.q3 });

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Check →'; }
  updateRetriesDisplay('q3');

  for (let i = 0; i < nEq; i++) {
    for (let j = 0; j <= nVar; j++) {
      const id  = j < nVar ? `aug-${i}-${j}` : `aug-${i}-b`;
      const inp = document.getElementById(id);
      inp.classList.remove('correct', 'wrong');
      if (data.results[i][j]) { inp.classList.add('correct'); inp.disabled = true; }
      else { inp.classList.add('wrong'); inp.value = ''; }
    }
  }

  if (data.all_correct) {
    lockQuiz('q3', data.score);
    showFeedback('q3-feedback', `✓ Correct! You earned <strong>${data.score} / 5</strong> marks.`, 'success');
    showNextButton('q3');
  } else {
    const retriesUsed = state.quizAttempts.q3 - 1;
    if (retriesUsed >= MAX_RETRIES) {
      for (let i = 0; i < nEq; i++) for (let j = 0; j <= nVar; j++) {
        const id  = j < nVar ? `aug-${i}-${j}` : `aug-${i}-b`;
        const inp = document.getElementById(id);
        if (!inp.disabled) { inp.value = data.correct_matrix[i][j]; inp.classList.replace('wrong', 'correct'); inp.disabled = true; }
      }
      lockQuiz('q3', 0);
      showFeedback('q3-feedback', '✗ Both attempts used. Correct matrix shown above. <strong>0 / 5</strong> marks.', 'error');
      showNextButton('q3');
    } else {
      showFeedback('q3-feedback', `✗ Some values are wrong (highlighted red). You have <strong>1 retry</strong> — no marks deducted yet.`, 'error');
      showRetryButton('q3', () => { hideRetryButton('q3'); document.getElementById('q3-submit-btn').disabled = false; });
      if (submitBtn) submitBtn.disabled = true;
    }
  }
}

function submitAugMatrix() {
  if (state.quizLocked.q3) return;
  const { nEq, nVar } = state;
  for (let i = 0; i < nEq; i++) for (let j = 0; j <= nVar; j++) {
    const id  = j < nVar ? `aug-${i}-${j}` : `aug-${i}-b`;
    const inp = document.getElementById(id);
    if (!inp.disabled && inp.value.trim() === '') {
      inp.focus();
      showFeedback('q3-feedback', '⚠️ Please fill all matrix cells before checking.', 'error');
      return;
    }
  }
  doSubmitAugMatrix();
}

// -- Card 4: Rank Quiz -----------------------------------------
async function doSubmitRank() {
  if (state.quizLocked.q4) return;
  state.quizAttempts.q4++;
  const submitBtn = document.getElementById('q4-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Checking…'; }

  const rcVal = document.getElementById('rank-coeff').value.trim();
  const raVal = document.getElementById('rank-aug').value.trim();
  const data  = await apiFetch('/api/quiz/rank', 'POST',
    { rank_coeff: rcVal, rank_aug: raVal, attempt: state.quizAttempts.q4, used_hint: state.hintUsed.q4 });

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Check →'; }
  updateRetriesDisplay('q4');
  if (!data.ok) { showFeedback('q4-feedback', '⚠️ ' + data.error, 'error'); return; }

  const rcInp = document.getElementById('rank-coeff');
  const raInp = document.getElementById('rank-aug');
  rcInp.classList.remove('correct', 'wrong'); raInp.classList.remove('correct', 'wrong');
  rcInp.classList.add(data.rc_correct ? 'correct' : 'wrong');
  raInp.classList.add(data.ra_correct ? 'correct' : 'wrong');
  if (data.rc_correct) rcInp.disabled = true;
  if (data.ra_correct) raInp.disabled = true;

  if (data.all_correct) {
    lockQuiz('q4', data.score);
    showFeedback('q4-feedback', `✓ Correct! You earned <strong>${data.score} / 5</strong> marks.`, 'success');
    showNextButton('q4');
  } else {
    const retriesUsed = state.quizAttempts.q4 - 1;
    if (retriesUsed >= MAX_RETRIES) {
      if (!data.rc_correct) { rcInp.value = data.correct_rc; rcInp.classList.replace('wrong', 'correct'); rcInp.disabled = true; }
      if (!data.ra_correct) { raInp.value = data.correct_ra; raInp.classList.replace('wrong', 'correct'); raInp.disabled = true; }
      lockQuiz('q4', 0);
      showFeedback('q4-feedback', '✗ Both attempts used. Correct values shown. <strong>0 / 5</strong> marks.', 'error');
      showNextButton('q4');
    } else {
      if (!data.rc_correct) rcInp.value = '';
      if (!data.ra_correct) raInp.value = '';
      showFeedback('q4-feedback',
        `✗ ${!data.rc_correct ? 'Rank of A is wrong. ' : ''}${!data.ra_correct ? 'Rank of [A|b] is wrong.' : ''} You have <strong>1 retry</strong> — no marks deducted yet.`, 'error');
      showRetryButton('q4', () => {
        hideRetryButton('q4');
        rcInp.classList.remove('correct', 'wrong'); raInp.classList.remove('correct', 'wrong');
        document.getElementById('q4-submit-btn').disabled = false;
        (!rcInp.disabled ? rcInp : raInp).focus();
      });
      if (submitBtn) submitBtn.disabled = true;
    }
  }
}

function submitRank() {
  if (state.quizLocked.q4) return;
  const rcVal = document.getElementById('rank-coeff').value.trim();
  const raVal = document.getElementById('rank-aug').value.trim();
  if (!rcVal || !raVal) { showFeedback('q4-feedback', '⚠️ Please fill both rank fields.', 'error'); return; }
  if (isNaN(parseInt(rcVal)) || isNaN(parseInt(raVal))) { showFeedback('q4-feedback', '⚠️ Ranks must be whole numbers like 1, 2, 3.', 'error'); return; }
  doSubmitRank();
}

// DOMContentLoaded setup
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input').forEach(inp => {
    if (inp.id === 'n-eq' || inp.id === 'n-var') {
      inp.value = '2';
    } else if (inp.type === 'radio' || inp.type === 'checkbox') {
      inp.checked = false;
    } else {
      inp.value = '';
    }
    inp.disabled = false;
    inp.classList.remove('correct', 'wrong');
  });

  document.querySelectorAll('.feedback-box').forEach(box => {
    box.style.display = 'none';
    box.innerHTML     = '';
    box.className     = 'feedback-box';
  });

  document.getElementById('rank-coeff')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('rank-aug').focus(); } });
  document.getElementById('rank-aug')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitRank(); } });
  document.getElementById('n-eq')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('n-var').focus(); } });
  document.getElementById('n-var')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); configureMatrix(); } });
  document.querySelectorAll('input[name="sol_type"]').forEach(radio => {
    radio.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitSolType(); } });
  });
});

// -- Card 5: Solution Type Quiz --------------------------------
async function doSubmitSolType() {
  if (state.quizLocked.q5) return;
  state.quizAttempts.q5++;
  const submitBtn = document.getElementById('q5-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Checking…'; }

  const selected = document.querySelector('input[name="sol_type"]:checked');
  const data = await apiFetch('/api/quiz/solution_type', 'POST',
    { answer: selected.value, attempt: state.quizAttempts.q5, used_hint: state.hintUsed.q5 });

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Check →'; }
  updateRetriesDisplay('q5');
  const labels = { unique: 'Unique Solution', infinite: 'Infinite Solutions', none: 'No Solution' };

  if (data.all_correct) {
    lockQuiz('q5', data.score);
    showFeedback('q5-feedback', `✓ Correct! You earned <strong>${data.score} / 5</strong> marks.`, 'success');
    showNextButton('q5');
  } else {
    const retriesUsed = state.quizAttempts.q5 - 1;
    if (retriesUsed >= MAX_RETRIES) {
      document.querySelectorAll('input[name="sol_type"]').forEach(r => { if (r.value === data.correct) r.checked = true; });
      lockQuiz('q5', 0);
      showFeedback('q5-feedback', `✗ Both attempts used. Answer: <strong>${labels[data.correct]}</strong>. <strong>0 / 5</strong> marks.`, 'error');
      showNextButton('q5');
    } else {
      showFeedback('q5-feedback', `✗ Incorrect. Think about the ranks you found. You have <strong>1 retry</strong> — no marks deducted yet.`, 'error');
      showRetryButton('q5', () => {
        hideRetryButton('q5');
        document.querySelectorAll('input[name="sol_type"]').forEach(r => r.checked = false);
        document.getElementById('q5-submit-btn').disabled = false;
      });
      if (submitBtn) submitBtn.disabled = true;
    }
  }
}

function submitSolType() {
  if (state.quizLocked.q5) return;
  const selected = document.querySelector('input[name="sol_type"]:checked');
  if (!selected) { showFeedback('q5-feedback', '⚠️ Please select one option before checking.', 'error'); return; }
  doSubmitSolType();
}

// ── Card 6: Final Answer Quiz ─────────────────────────────────
function buildFinalAnswerCard() {
  const wrap = document.getElementById('final-answer-wrap');
  const { nVar, solType } = state;

  document.getElementById('q6-sub').textContent =
    solType === 'none'     ? 'This system has no solution.' :
    solType === 'unique'   ? 'Enter the unique value for each variable.' :
                             'Enter the parametric solution using z as the free variable.';

  if (solType === 'none') {
    wrap.innerHTML = '<div class="no-sol-msg">∅ No Solution — This system is inconsistent.</div>';
    document.getElementById('q6-hint-btn').style.display = 'none';
    document.getElementById('q6-submit-btn').textContent = 'See Results →';
    updateRetriesDisplay('q6');
    return;
  }

  if (solType === 'unique') {
    let html = '<div class="final-unique-grid">';
    for (let i = 0; i < nVar; i++) {
      html += `<div class="final-var-row">
        <span class="var-label">${varLabel(i)}</span>
        <span class="equals-sign">=</span>
        <input type="text" inputmode="decimal" pattern="[-.0-9/]*" class="num-input final-input"
               id="final-${i}" placeholder="e.g. 3 or 1/3" autocomplete="off"/>
      </div>`;
    }
    html += '</div>';
    wrap.innerHTML = html;
    const inputs = Array.from(wrap.querySelectorAll('.final-input'));
    inputs.forEach((inp, idx) => {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); idx + 1 < inputs.length ? inputs[idx + 1].focus() : submitFinalAnswer(); }
      });
    });

  } else if (solType === 'infinite') {
    let html = '<div class="final-inf-grid">';
    for (let i = 0; i < nVar; i++) {
      html += `<div class="final-var-row" id="final-row-${i}">
        <span class="var-label">${varLabel(i)}</span>
        <span class="equals-sign">=</span>
        <span id="final-free-${i}"></span>
      </div>`;
    }
    html += '</div>';
    wrap.innerHTML = html;

    // Issue #5: Use /api/quiz/infinite_structure instead of hint endpoint
    fetch('/api/quiz/infinite_structure').then(r => r.json()).then(d => {
      if (!d.structure) return;
      d.structure.forEach((entry, i) => {
        const span = document.getElementById(`final-free-${i}`);
        if (!span) return;
        if (entry.is_free) {
          span.innerHTML = `<span class="param-label" style="color:var(--blue)">z (free variable)</span>`;
        } else {
          span.innerHTML = `
            <input type="text" inputmode="text" pattern="[-.0-9/]*" class="num-input final-input"
                   id="final-${i}-coeff" style="width:72px" placeholder="coeff" autocomplete="off"/>
            <span class="param-label">z +</span>
            <input type="text" inputmode="text" pattern="[-.0-9/]*" class="num-input final-input"
                   id="final-${i}-const" style="width:72px" placeholder="const" autocomplete="off"/>`;
        }
      });
    });
  }
  updateRetriesDisplay('q6');
}

async function doSubmitFinalAnswer() {
  if (state.quizLocked.q6) return;
  if (state.solType === 'none') {
    const data = await apiFetch('/api/quiz/final_answer', 'POST', { attempt: 1, used_hint: false });
    if (data.ok) lockQuiz('q6', data.score);
    loadResults();
    return;
  }

  state.quizAttempts.q6++;
  const submitBtn = document.getElementById('q6-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Checking…'; }

  let body = { attempt: state.quizAttempts.q6, used_hint: state.hintUsed.q6 };
  const values = {};
  if (state.solType === 'unique') {
    for (let i = 0; i < state.nVar; i++) values[i] = document.getElementById(`final-${i}`)?.value ?? '';
    body.values = values;
  } else {
    for (let i = 0; i < state.nVar; i++) {
      const c = document.getElementById(`final-${i}-coeff`);
      const k = document.getElementById(`final-${i}-const`);
      if (c) values[`${i}_coeff`] = c.value;
      if (k) values[`${i}_const`] = k.value;
    }
    body.values = values;
  }

  const data = await apiFetch('/api/quiz/final_answer', 'POST', body);
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Check →'; }
  updateRetriesDisplay('q6');
  if (!data.ok) { alert(data.error); return; }

  if (state.solType === 'unique' && data.results) {
    Object.entries(data.results).forEach(([k, r]) => {
      const inp = document.getElementById(`final-${k}`);
      if (!inp) return;
      inp.classList.remove('correct', 'wrong');
      inp.classList.add(r.ok ? 'correct' : 'wrong');
      if (r.ok) inp.disabled = true;
      else inp.value = '';
    });
  } else if (state.solType === 'infinite' && data.results) {
    Object.entries(data.results).forEach(([k, r]) => {
      if (r.free) return;
      const c  = document.getElementById(`final-${k}-coeff`);
      const kk = document.getElementById(`final-${k}-const`);
      if (c)  { c.classList.remove('correct','wrong');  c.classList.add(r.ok?'correct':'wrong');  if (r.ok) c.disabled  = true; else c.value  = ''; }
      if (kk) { kk.classList.remove('correct','wrong'); kk.classList.add(r.ok?'correct':'wrong'); if (r.ok) kk.disabled = true; else kk.value = ''; }
    });
  }

  if (data.all_correct) {
    lockQuiz('q6', data.score);
    showFeedback('q6-feedback', `✓ Correct! You earned <strong>${data.score} / 5</strong> marks.`, 'success');
    setTimeout(loadResults, 1000);
  } else {
    const retriesUsed = state.quizAttempts.q6 - 1;
    if (retriesUsed >= MAX_RETRIES) {
      if (data.results) Object.entries(data.results).forEach(([k, r]) => {
        if (r.free) return;
        if (state.solType === 'unique') {
          const inp = document.getElementById(`final-${k}`);
          if (inp && !r.ok) { inp.value = r.correct; inp.classList.replace('wrong','correct'); inp.disabled = true; }
        } else {
          const c  = document.getElementById(`final-${k}-coeff`);
          const kk = document.getElementById(`final-${k}-const`);
          if (c  && !r.ok) { c.value  = r.corr_coeff; c.classList.replace('wrong','correct');  c.disabled  = true; }
          if (kk && !r.ok) { kk.value = r.corr_const; kk.classList.replace('wrong','correct'); kk.disabled = true; }
        }
      });
      lockQuiz('q6', 0);
      showFeedback('q6-feedback', '✗ Both attempts used. Correct answers shown. <strong>0 / 5</strong> marks.', 'error');
      showNextButton('q6');
      const nextBtn = document.getElementById('q6-next-btn');
      if (nextBtn) { nextBtn.onclick = loadResults; }
    } else {
      showFeedback('q6-feedback', `✗ Some answers are wrong (highlighted red). You have <strong>1 retry</strong> — no marks deducted yet.`, 'error');
      showRetryButton('q6', () => { hideRetryButton('q6'); document.getElementById('q6-submit-btn').disabled = false; });
      if (submitBtn) submitBtn.disabled = true;
    }
  }
}

function submitFinalAnswer() {
  if (state.quizLocked.q6) return;
  if (state.solType === 'none') { doSubmitFinalAnswer(); return; }

  if (state.solType === 'unique') {
    for (let i = 0; i < state.nVar; i++) {
      const inp = document.getElementById(`final-${i}`);
      if (inp && inp.value.trim() === '') { inp.focus(); showFeedback('q6-feedback', `⚠️ Please fill in ${varLabel(i)} before submitting.`, 'error'); return; }
    }
  }

  // Issue #19: Validate empty fields for infinite solution
  if (state.solType === 'infinite') {
    for (let i = 0; i < state.nVar; i++) {
      const c  = document.getElementById(`final-${i}-coeff`);
      const kk = document.getElementById(`final-${i}-const`);
      if (c && !c.disabled && c.value.trim() === '') {
        c.focus();
        showFeedback('q6-feedback', `⚠️ Please fill the coefficient for ${varLabel(i)}.`, 'error');
        return;
      }
      if (kk && !kk.disabled && kk.value.trim() === '') {
        kk.focus();
        showFeedback('q6-feedback', `⚠️ Please fill the constant for ${varLabel(i)}.`, 'error');
        return;
      }
    }
  }

  doSubmitFinalAnswer();
}

// ── Hint Modal ────────────────────────────────────────────────
function showHintModal(title, htmlContent, onConfirm) {
  if (onConfirm) onConfirm();
  document.getElementById('hint-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'hint-modal';
  modal.innerHTML = `
    <div class="hint-overlay">
      <div class="hint-box">
        <div class="hint-box-header"><span class="hint-icon">💡</span><span>${title}</span></div>
        <div class="hint-box-body">${htmlContent}</div>
        <div class="hint-box-warning">⚠️ Hint used. Your score for this quiz will be <strong>0 marks</strong>.</div>
        <div class="hint-box-actions">
          <button class="btn btn-primary" onclick="closeHintModal()">Close</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}
function closeHintModal() { document.getElementById('hint-modal')?.remove(); }

// ── Hints ─────────────────────────────────────────────────────
async function showHint(quiz, qKey) {
  if (state.hintUsed[qKey] || state.quizLocked[qKey]) return;
  const hintBtn = document.getElementById(`${qKey}-hint-btn`);
  if (hintBtn) { hintBtn.disabled = true; hintBtn.textContent = 'Loading…'; }
  const data = await apiFetch(`/api/get_hint/${quiz}`);
  if (hintBtn) hintBtn.style.display = 'none';
  state.hintUsed[qKey] = true;

  let html = `<div class="hint-answer-reveal">`;
  html += `<div class="hint-answer-title">💡 Correct Answer &amp; Explanation</div>`;

  if (quiz === 'augmented_matrix' && data.correct_matrix) {
    html += `<div class="hint-matrix-display">`;
    data.correct_matrix.forEach(row => {
      const nVar = state.nVar;
      html += `<div class="aug-row" style="justify-content:center;gap:8px;margin:4px 0">`;
      row.forEach((val, j) => {
        if (j === nVar) html += `<span style="color:var(--text-muted);font-weight:700;padding:0 6px">|</span>`;
        html += `<span class="hint-cell">${val}</span>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
    html += `<div class="hint-steps"><p>${data.explanation}</p></div>`;

  } else if (quiz === 'rank') {
    html += `<div class="hint-values">rank(A) = <strong>${data.rank_coeff}</strong> &nbsp;|&nbsp; rank([A|b]) = <strong>${data.rank_aug}</strong></div>`;
    html += `<div class="hint-steps">${data.explanation}</div>`;

  } else if (quiz === 'solution_type') {
    const labels = { unique: 'Unique Solution', infinite: 'Infinite Solutions', none: 'No Solution' };
    html += `<div class="hint-values">Answer: <strong>${labels[data.correct] || data.label}</strong></div>`;
    html += `<div class="hint-steps">${data.explanation}</div>`;

  } else if (quiz === 'final_answer') {
    if (data.sol_type === 'unique' && data.unique_sol) {
      let vars = Object.entries(data.unique_sol).map(([k,v]) => `${varLabel(parseInt(k))} = ${v}`).join('<br>');
      html += `<div class="hint-values">${vars}</div>`;
    } else if (data.sol_type === 'infinite' && data.inf_sol) {
      let vars = data.inf_sol.map((entry, i) =>
        entry[0] === 'free' ? `${varLabel(i)} = z (free)` : `${varLabel(i)} = ${entry[0]}z + ${entry[1]}`
      ).join('<br>');
      html += `<div class="hint-values">${vars}</div>`;
    } else {
      html += `<div class="hint-values">∅ No solution — system is inconsistent.</div>`;
    }
    html += `<div class="hint-steps">${data.explanation || ''}</div>`;
  }

  html += `<div class="hint-zero-warning">⚠️ Hint used — score for this card: <strong>0 / 5</strong></div>`;
  html += `</div>`;

  showFeedback(`${qKey}-feedback`, html, 'info');
  lockQuiz(qKey, 0);
  showNextButton(qKey);
  document.querySelectorAll(`#card-${qKey.replace('q','')} input`).forEach(inp => { inp.disabled = true; });
}

// ── Lock quiz ─────────────────────────────────────────────────
function lockQuiz(qKey, score) {
  state.quizLocked[qKey] = true;
  if (score !== null && score !== undefined) {
    // Issue #8: Store using backend key so score badge totals match DB
    const backendKey = QUIZ_KEY_MAP[qKey] || qKey;
    state.scores[backendKey] = score;
    refreshScoreBadge();
  }
  document.getElementById(`${qKey}-submit-btn`)?.setAttribute('disabled', true);
  document.getElementById(`${qKey}-hint-btn`)?.setAttribute('disabled', true);
  hideRetryButton(qKey);
  updateRetriesDisplay(qKey);
}

// ── Show Next Button ─────────────────────────────────────────
function showNextButton(qKey) {
  const submitBtn = document.getElementById(`${qKey}-submit-btn`);
  const nextBtn   = document.getElementById(`${qKey}-next-btn`);
  if (submitBtn) submitBtn.style.display = 'none';
  if (nextBtn)   nextBtn.style.display   = 'inline-flex';
  // Issue #21: Removed dead empty event listener
}

// -- Results ---------------------------------------------------
async function loadResults() {
  goCard(7);
  const data = await apiFetch('/api/get_results');
  if (!data.ok) return;
  const body    = document.getElementById('results-body');
  const qLabels = { aug_matrix: 'Augmented Matrix', rank: 'Rank', sol_type: 'Solution Type', final_answer: 'Final Answer' };

  let deltaBadge = '';
  if (data.prev_total != null) {
    const delta = data.total - data.prev_total;
    const sign  = delta >= 0 ? '+' : '';
    const col   = delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--muted)';
    deltaBadge  = `<div class="score-delta" style="color:${col};font-size:.85rem;margin-top:4px">${sign}${delta.toFixed(1)} vs last attempt</div>`;
  }

  let html = `<div class="score-display">
    <div class="score-big">${data.total.toFixed(1)}</div>
    <div class="score-total">/ 20 marks</div>
    ${deltaBadge}
    <div class="score-breakdown">`;
  for (const [k, label] of Object.entries(qLabels)) {
    const s = data.scores[k] ?? 0;
    const colour = s >= 4 ? 'var(--green)' : s >= 2.5 ? 'var(--amber)' : 'var(--red)';
    html += `<div class="score-pill">${label}: <span style="color:${colour}">${s}/5</span></div>`;
  }
  html += '</div></div>';

  html += '<div class="section-title">Final Solution</div><div class="final-solution">';
  if (data.sol_type === 'none') {
    html += '<span style="color:var(--red)">∅ No solution — system is inconsistent.</span>';
  } else if (data.sol_type === 'unique') {
    for (const [k, v] of Object.entries(data.unique_sol)) html += `${varLabel(parseInt(k))} = ${v}<br/>`;
  } else {
    data.inf_sol.forEach((entry, i) => {
      html += entry[0] === 'free'
        ? `${varLabel(i)} = z &nbsp;<span style="color:var(--blue)">(free)</span><br/>`
        : `${varLabel(i)} = ${entry[0]}z + ${entry[1]}<br/>`;
    });
  }
  html += '</div>';

  html += '<div class="section-title">Gaussian Elimination Steps</div><div class="steps-list">';
  data.steps.forEach(step => {
    html += `<div class="step-item"><div class="step-desc">${step.desc}</div><div class="step-matrix">`;
    step.matrix.forEach(row => {
      html += '<div class="step-row">';
      row.forEach((cell, j) => {
        if (j === data.n_var) html += '<span class="step-sep">|</span>';
        html += `<span class="step-cell">${cell}</span>`;
      });
      html += '</div>';
    });
    html += '</div></div>';
  });
  html += '</div>';
  html += `<div class="restart-wrap">
    <button class="btn-restart" onclick="window.location.href='/quiz'">↺ New Problem</button>
    <button class="btn-restart btn-dashboard-link" onclick="window.location.href='/progress'">📊 My Progress</button>
    <button class="btn-restart btn-dashboard-link" onclick="window.location.href='/dashboard'">View Dashboard →</button>
  </div>`;
  body.innerHTML = html;
}
