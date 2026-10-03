const $app = document.getElementById("app");
let config = null;
let timerHandle = null;

// ---------- helpers ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Minimal formatting: paragraphs, "- " / "1. " lists, **bold**. Input is escaped first. */
function fmt(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").split("\n");
  let html = "";
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { html += `<p>${para.join("<br>")}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    const ul = line.match(/^[-*•]\s+(.*)/);
    const ol = line.match(/^\d+[.)]\s+(.*)/);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
      html += `<li>${(ul || ol)[1]}</li>`;
    } else if (!line) {
      flushPara(); closeList();
    } else {
      closeList(); para.push(line);
    }
  }
  flushPara(); closeList();
  return html;
}

const scoreClass = (n, prefix = "s") => (n >= 7 ? `${prefix}-good` : n >= 5 ? `${prefix}-mid` : `${prefix}-bad`);
const catLabel = (cat) => config.categories[cat].label;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const prettyDate = (d) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function setNav(name) {
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
}

function loading(msg, sub = "") {
  $app.innerHTML = `<div class="loading"><div class="spinner"></div><div>${esc(msg)}</div><div class="muted small">${esc(sub)}</div></div>`;
}

function showError(err, el = $app) {
  el.insertAdjacentHTML("afterbegin", `<div class="error">${esc(err.message || err)}</div>`);
}

// ---------- router ----------

async function route() {
  clearInterval(timerHandle);
  const hash = location.hash.slice(1) || "/";
  const [, view, arg] = hash.split("/");
  try {
    if (view === "s" && arg) return await renderSession(arg);
    if (view === "progress") return await renderProgress();
    if (view === "profile") return await renderProfile();
    if (view === "day" && arg) return await renderDay(arg);
    return await renderDay(config.today);
  } catch (err) {
    $app.innerHTML = "";
    showError(err);
  }
}

// ---------- Today / day view ----------

async function renderDay(date) {
  setNav(date === config.today ? "today" : "");
  loading("Loading questions…");
  let day;
  try {
    day = await api(`/api/day/${date}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    loading("Generating your 6 questions for " + prettyDate(date) + "…", "Tailored to your profile. This takes about a minute.");
    day = await api(`/api/day/${date}/generate`, { method: "POST" });
  }
  const days = await api("/api/days");
  if (!days.some((d) => d.date === config.today)) days.unshift({ date: config.today, total: 6, done: 0 });

  const done = day.questions.filter((q) => q.attempts > 0).length;
  const sections = ["guesstimate", "rca", "product_design"]
    .map((cat) => {
      const qs = day.questions.filter((q) => q.category === cat);
      return `
      <section class="section">
        <div class="section-title"><span class="dot" style="background:var(--cat-${cat})"></span><h2>${esc(catLabel(cat))}</h2>
          <span class="muted small">~${config.categories[cat].targetMinutes} min each</span></div>
        <div class="grid2">${qs.map(questionCard).join("")}</div>
      </section>`;
    })
    .join("");

  $app.innerHTML = `
    <div class="day-head row spread">
      <div>
        <h1>${date === config.today ? "Today's practice" : "Practice set"}</h1>
        <div class="muted">${prettyDate(date)} · ${done}/6 attempted</div>
      </div>
      <div class="row">
        <select id="daypick" aria-label="Choose a day">
          ${days.map((d) => `<option value="${d.date}" ${d.date === date ? "selected" : ""}>${prettyDate(d.date)}${d.date === config.today ? " (today)" : ""} — ${d.done}/${d.total}</option>`).join("")}
        </select>
        <button class="btn ghost" id="regen" title="Replace this day's questions with a new set">↻ New set</button>
      </div>
    </div>
    ${sections}`;

  document.getElementById("daypick").onchange = (e) => {
    location.hash = e.target.value === config.today ? "#/" : `#/day/${e.target.value}`;
  };
  document.getElementById("regen").onclick = async () => {
    if (!confirm("Replace this day's 6 questions with a fresh set? Past attempts stay in your progress history.")) return;
    loading("Generating a fresh set…", "This takes about a minute.");
    try {
      await api(`/api/day/${date}/generate?force=1`, { method: "POST" });
      renderDay(date);
    } catch (err) {
      $app.innerHTML = "";
      showError(err);
    }
  };
  $app.querySelectorAll("[data-start]").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const s = await api("/api/sessions", { method: "POST", body: { date, qid: btn.dataset.start, fresh: btn.dataset.fresh === "1" } });
        location.hash = `#/s/${s.id}`;
      } catch (err) {
        btn.disabled = false;
        showError(err);
      }
    };
  });
}

function questionCard(q) {
  const status = q.attempts
    ? `<span class="score-pill ${scoreClass(q.best)}">Best ${q.best}/10</span>`
    : q.openSession ? `<span class="tag">In progress</span>` : `<span class="muted small">Not attempted</span>`;
  const actions = [];
  if (q.openSession) actions.push(`<a class="btn primary" href="#/s/${q.openSession}">Resume</a>`);
  else if (q.attempts) actions.push(`<button class="btn" data-start="${q.id}" data-fresh="1">Retry</button>`);
  else actions.push(`<button class="btn primary" data-start="${q.id}">Start</button>`);
  if (q.lastScored) actions.unshift(`<a class="btn ghost" href="#/s/${q.lastScored}">Feedback</a>`);
  return `
    <article class="card qcard">
      <div class="row">
        <span class="tag ${q.difficulty}">${esc(q.difficulty)}</span>
        <span class="tag">${esc(q.domain)}</span>
        ${q.style ? `<span class="tag">${esc(q.style)}</span>` : ""}
      </div>
      <h3>${esc(q.title)}</h3>
      <div class="prompt muted">${esc(q.prompt)}</div>
      <div class="foot">${status}<div class="row">${actions.join("")}</div></div>
    </article>`;
}

// ---------- Session (interview) ----------

const STAGE_TIPS = {
  clarify: {
    guesstimate: ["Pin down the unit, geography and time period.", "Ask what's in/out of scope.", "Don't ask for numbers you're meant to estimate."],
    rca: ["Confirm how the metric is defined and computed.", "Sudden or gradual? Exact timeframe?", "Rule out tracking / data issues early.", "Ask which segments are affected."],
    product_design: ["What is the company and its goal?", "Who is the user / any constraints?", "Platform, geography, timeline?", "How will success be measured?"],
  },
  answer: {
    guesstimate: ["State your approach and why.", "Segment the population (MECE).", "Say every assumption out loud.", "Sanity-check and give a range."],
    rca: ["Lay out a hypothesis tree first.", "Ask for specific data cuts.", "Narrow down; explain the mechanism.", "End with fix + prevention."],
    product_design: ["Segments → pick one, with rationale.", "Journey → prioritised pain points.", "3+ solutions → prioritise → MVP.", "North-star + guardrail metrics, risks."],
  },
};

async function renderSession(id) {
  setNav("");
  loading("Loading interview…");
  const s = await api(`/api/sessions/${id}`);
  if (s.result) return renderReport(s);

  const q = s.question;
  const cat = config.categories[q.category];
  $app.innerHTML = `
    <div class="session">
      <div>
        <div class="card qhead">
          <div class="row spread">
            <div class="row">
              <span class="tag cat cat-${q.category}">${esc(cat.label)}</span>
              <span class="tag ${q.difficulty}">${esc(q.difficulty)}</span>
              <span class="tag">${esc(q.domain)}</span>
            </div>
            <div class="small muted">⏱ <span class="timer" id="timer">0:00</span> / ${cat.targetMinutes}:00</div>
          </div>
          <div class="prompt">${esc(q.prompt)}</div>
          <div class="stepper">
            <div class="step" data-step="clarify">1 · Clarify</div>
            <div class="step" data-step="answer">2 · Answer</div>
            <div class="step" data-step="score">3 · Score</div>
          </div>
        </div>
        <div class="chat" id="chat"></div>
        <div class="card composer">
          <textarea id="input" rows="4"></textarea>
          <div class="row spread">
            <span class="muted small">Ctrl/⌘ + Enter to send</span>
            <div class="row">
              <button class="btn" id="stageBtn"></button>
              <button class="btn primary" id="send">Send</button>
            </div>
          </div>
        </div>
      </div>
      <aside class="side">
        <div class="card">
          <h3 id="tipsTitle"></h3>
          <ul class="small" id="tips"></ul>
        </div>
        <div class="card notes">
          <div class="row spread"><h3>Scratchpad</h3><span class="muted small" id="saved"></span></div>
          <textarea id="notes" placeholder="Rough math, structure, hypothesis tree… (autosaved, read by the scorer)">${esc(s.notes || "")}</textarea>
        </div>
        <div class="card">
          <h3>You'll be scored on</h3>
          <ul class="small rubric">${cat.dimensions.map((d) => `<li>${esc(d.label)} <span class="muted">· ${d.weight}%</span></li>`).join("")}</ul>
        </div>
      </aside>
    </div>`;

  const $chat = document.getElementById("chat");
  const $input = document.getElementById("input");
  const $send = document.getElementById("send");
  const $stageBtn = document.getElementById("stageBtn");
  let state = s;
  let busy = false;

  const startedAt = new Date(s.startedAt).getTime();
  const $timer = document.getElementById("timer");
  const tick = () => {
    const sec = (Date.now() - startedAt) / 1000;
    $timer.textContent = mmss(sec);
    $timer.classList.toggle("over", sec > cat.targetMinutes * 60);
  };
  tick();
  timerHandle = setInterval(tick, 1000);

  function paint() {
    let html = "";
    let shownDivider = false;
    for (const t of state.turns) {
      if (t.stage === "answer" && !shownDivider) {
        html += `<div class="divider">— Answer phase —</div>`;
        shownDivider = true;
      }
      const me = t.role === "user";
      html += `<div class="msg ${me ? "me" : "interviewer"} ${t.stage}"><div class="who">${me ? "You" : "Interviewer"}</div>${fmt(t.text)}</div>`;
    }
    if (state.stage === "answer" && !shownDivider) html += `<div class="divider">— Answer phase —</div>`;
    if (busy) html += `<div class="msg interviewer typing">Interviewer is typing…</div>`;
    $chat.innerHTML = html;

    const stage = state.stage;
    document.querySelectorAll("[data-step]").forEach((el) => {
      const order = ["clarify", "answer", "score"];
      const i = order.indexOf(el.dataset.step);
      const cur = order.indexOf(stage);
      el.classList.toggle("on", i === cur);
      el.classList.toggle("done", i < cur);
    });
    $input.placeholder =
      stage === "clarify"
        ? "Ask a clarifying question (e.g. “How is the metric defined?”)…"
        : "Share your structure / answer. You can send it in parts — the interviewer may probe.";
    $stageBtn.textContent = stage === "clarify" ? "Done clarifying → Answer" : "Finish & get scored";
    $stageBtn.className = stage === "clarify" ? "btn" : "btn primary";
    $send.className = stage === "clarify" ? "btn primary" : "btn";
    $send.disabled = $stageBtn.disabled = busy;
    document.getElementById("tipsTitle").textContent = stage === "clarify" ? "Clarifying — checklist" : "Answering — checklist";
    document.getElementById("tips").innerHTML = STAGE_TIPS[stage][q.category].map((t) => `<li>${esc(t)}</li>`).join("");
  }
  paint();
  $input.focus();

  async function send() {
    const text = $input.value.trim();
    if (!text || busy) return;
    busy = true;
    state = { ...state, turns: [...state.turns, { role: "user", stage: state.stage, text }] };
    $input.value = "";
    paint();
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    try {
      state = await api(`/api/sessions/${id}/messages`, { method: "POST", body: { text } });
    } catch (err) {
      state = { ...state, turns: state.turns.slice(0, -1) };
      $input.value = text;
      showError(err, $chat.parentElement);
    }
    busy = false;
    paint();
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    $input.focus();
  }

  $send.onclick = send;
  $input.onkeydown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  };

  $stageBtn.onclick = async () => {
    if (busy) return;
    if ($input.value.trim()) await send();
    if (state.stage === "clarify") {
      const asked = state.turns.filter((t) => t.role === "user").length;
      if (!asked && !confirm("You haven't asked any clarifying questions. Interviewers notice — move on anyway?")) return;
      state = await api(`/api/sessions/${id}/stage`, { method: "POST" });
      paint();
      $input.focus();
      return;
    }
    const answered = state.turns.some((t) => t.role === "user" && t.stage === "answer");
    if (!answered && !confirm("You haven't given an answer yet. Score anyway?")) return;
    busy = true;
    paint();
    await saveNotes();
    loading("Scoring your interview…", "Evaluating clarifying questions, structure and more. ~30-60 seconds.");
    clearInterval(timerHandle);
    try {
      renderReport(await api(`/api/sessions/${id}/score`, { method: "POST" }));
      window.scrollTo({ top: 0 });
    } catch (err) {
      await renderSession(id);
      showError(err);
    }
  };

  const $notes = document.getElementById("notes");
  const $saved = document.getElementById("saved");
  let notesTimer;
  async function saveNotes() {
    clearTimeout(notesTimer);
    try {
      await api(`/api/sessions/${id}/notes`, { method: "PUT", body: { notes: $notes.value } });
      $saved.textContent = "saved";
    } catch {
      $saved.textContent = "not saved";
    }
  }
  $notes.oninput = () => {
    $saved.textContent = "…";
    clearTimeout(notesTimer);
    notesTimer = setTimeout(saveNotes, 800);
  };
}

// ---------- Report ----------

function renderReport(s) {
  const q = s.question;
  const r = s.result;
  const cat = config.categories[q.category];
  const dimLabel = Object.fromEntries(cat.dimensions.map((d) => [d.key, d]));
  const dims = cat.dimensions.map((d) => r.dimensions.find((x) => x.key === d.key)).filter(Boolean);
  const list = (items) => (items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="muted small">—</p>`);
  const clarifyQs = s.turns.filter((t) => t.role === "user" && t.stage === "clarify");

  $app.innerHTML = `
    <div class="stack">
      <div class="row spread">
        <a href="${s.date === config.today ? "#/" : `#/day/${s.date}`}">← Back to ${s.date === config.today ? "today" : prettyDate(s.date)}</a>
        <button class="btn" id="retry">↻ Retry this question</button>
      </div>

      <div class="card report-head">
        <div class="big-score ${scoreClass(r.overall)}">${r.overall}<small>/ 10</small></div>
        <div>
          <div class="row">
            <span class="tag cat cat-${q.category}">${esc(cat.label)}</span>
            <span class="tag ${q.difficulty}">${esc(q.difficulty)}</span>
            <span class="tag">${esc(r.verdict)}</span>
            <span class="muted small">⏱ ${mmss(r.elapsedSec)} (target ${cat.targetMinutes}:00) · ${r.clarifyingCount} clarifying question${r.clarifyingCount === 1 ? "" : "s"}</span>
          </div>
          <h2 style="margin-top:.6rem">${esc(q.title)}</h2>
          <p class="muted">${esc(q.prompt)}</p>
          <p>${esc(r.summary)}</p>
        </div>
      </div>

      <div class="card">
        <h2>Scorecard</h2>
        ${dims.map((d) => `
          <div class="dim">
            <div class="row spread"><strong>${esc(dimLabel[d.key].label)} <span class="muted small">· ${dimLabel[d.key].weight}%</span></strong>
              <span class="score-pill ${scoreClass(d.score)}">${d.score}/10</span></div>
            <div class="bar"><span class="${scoreClass(d.score, "b")}" style="width:${d.score * 10}%"></span></div>
            <div class="small"><strong>What you did:</strong> ${esc(d.evidence)}</div>
            <div class="small"><strong>Do better:</strong> ${esc(d.improve)}</div>
          </div>`).join("")}
      </div>

      <div class="card">
        <h2>Your clarifying questions</h2>
        ${clarifyQs.length ? `<ol class="small muted">${clarifyQs.map((t) => `<li>${esc(t.text)}</li>`).join("")}</ol>` : `<p class="muted small">You didn't ask any.</p>`}
        <div class="cols3">
          <div><h3 style="color:var(--good)">Sharp</h3>${list(r.clarifying_review.good)}</div>
          <div><h3 style="color:var(--warn)">Low value</h3>${list(r.clarifying_review.wasted)}</div>
          <div><h3 style="color:var(--bad)">Missed</h3>${list(r.clarifying_review.missed)}</div>
        </div>
      </div>

      <div class="cols3 cols-1-2">
        <div class="card"><h2>Strengths</h2>${list(r.strengths)}</div>
        <div class="card"><h2>Top improvements</h2>${list(r.improvements)}</div>
      </div>

      <div class="card">
        <h2>Model answer</h2>
        <div>${fmt(r.model_answer)}</div>
      </div>

      ${q.brief ? `
      <div class="card">
        <details>
          <summary>Interviewer's hidden brief</summary>
          <p><strong>What was really going on:</strong> ${esc(q.brief.hidden_context)}</p>
          <p><strong>Expected approach:</strong> ${esc(q.brief.expected_approach)}</p>
          <dl class="kv">${q.brief.clarification_facts.map((f) => `<dt>${esc(f.topic)}</dt><dd>${esc(f.answer)}</dd>`).join("")}</dl>
        </details>
      </div>` : ""}

      <div class="card">
        <details>
          <summary>Full transcript</summary>
          <div class="chat">${s.turns.map((t) => `<div class="msg ${t.role === "user" ? "me" : "interviewer"} ${t.stage}"><div class="who">${t.role === "user" ? `You · ${t.stage}` : "Interviewer"}</div>${fmt(t.text)}</div>`).join("")}</div>
          ${s.notes ? `<h3>Scratchpad</h3><pre class="small" style="white-space:pre-wrap">${esc(s.notes)}</pre>` : ""}
        </details>
      </div>
    </div>`;

  document.getElementById("retry").onclick = async () => {
    const n = await api("/api/sessions", { method: "POST", body: { date: s.date, qid: s.qid, fresh: true } });
    location.hash = `#/s/${n.id}`;
  };
}

// ---------- Progress ----------

async function renderProgress() {
  setNav("progress");
  loading("Loading progress…");
  const p = await api("/api/progress");
  const cats = Object.entries(p.byCategory);
  const statCard = (label, value, sub = "") =>
    `<div class="card stat"><div class="muted small">${label}</div><div class="n">${value ?? "—"}</div><div class="muted small">${sub}</div></div>`;

  $app.innerHTML = `
    <h1>Progress</h1>
    <div class="stats">
      ${statCard("Interviews scored", p.total)}
      ${statCard("Day streak", p.streak, p.streak ? "keep it going" : "practise today to start one")}
      ${cats.map(([, c]) => statCard(`${c.label} avg`, c.avg, c.count ? `${c.count} done · last 4: ${c.recentAvg}` : "no attempts")).join("")}
    </div>

    <h2 style="margin-top:1.5rem">Skill breakdown</h2>
    <p class="muted small">Average score per rubric dimension. Your lowest bars are where practice pays off most.</p>
    <div class="cols3">
      ${cats.map(([key, c]) => `
        <div class="card">
          <div class="section-title"><span class="dot" style="background:var(--cat-${key})"></span><h3 style="margin:0">${esc(c.label)}</h3></div>
          ${c.dims.map((d) => `
            <div class="dimrow">
              <span>${esc(d.label)}</span>
              <div class="bar">${d.avg != null ? `<span class="${scoreClass(d.avg, "b")}" style="width:${d.avg * 10}%"></span>` : ""}</div>
              <strong>${d.avg ?? "—"}</strong>
            </div>`).join("")}
        </div>`).join("")}
    </div>

    <h2 style="margin-top:1.5rem">Recent interviews</h2>
    <div class="card">
      ${p.recent.length ? `
      <table>
        <thead><tr><th>Date</th><th>Round</th><th>Question</th><th>Score</th><th>Verdict</th></tr></thead>
        <tbody>${p.recent.map((r) => `
          <tr>
            <td>${esc(r.date)}</td>
            <td><span class="tag cat cat-${r.category}">${esc(catLabel(r.category))}</span></td>
            <td><a href="#/s/${r.id}">${esc(r.title)}</a></td>
            <td><span class="score-pill ${scoreClass(r.overall)}">${r.overall}</span></td>
            <td class="small">${esc(r.verdict)}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : `<p class="muted">No scored interviews yet. <a href="#/">Start today's set →</a></p>`}
    </div>`;
}

// ---------- Profile ----------

async function renderProfile() {
  setNav("profile");
  const { text } = await api("/api/profile");
  $app.innerHTML = `
    <h1>Your profile</h1>
    <p class="muted">Questions are tailored to this. Changes apply to newly generated sets (use “↻ New set” on Today to regenerate).</p>
    <div class="card profile">
      <textarea id="profile" rows="10">${esc(text)}</textarea>
      <div class="row" style="margin-top:.6rem"><button class="btn primary" id="save">Save profile</button><span class="muted small" id="status"></span></div>
    </div>
    <h2 style="margin-top:1.5rem">How a day works</h2>
    <div class="card small">
      <ul>
        <li><strong>2 Guesstimates</strong> with India context, rotating top-down / bottom-up / supply-side / demand-side styles.</li>
        <li><strong>2 RCAs</strong> — one consumer product, one fintech / healthtech / logistics / B2B SaaS.</li>
        <li><strong>2 Product Design</strong> — one in fintech / healthtech / logistics / SaaS, one open.</li>
        <li>Each category has one easier and one harder question. Recent questions are not repeated.</li>
        <li>Each interview: <strong>Clarify</strong> (ask the interviewer questions) → <strong>Answer</strong> (present; the interviewer may probe) → <strong>Score</strong> against a weighted rubric with a model answer.</li>
      </ul>
    </div>`;
  document.getElementById("save").onclick = async () => {
    const $s = document.getElementById("status");
    try {
      await api("/api/profile", { method: "PUT", body: { text: document.getElementById("profile").value } });
      $s.textContent = "Saved.";
    } catch (err) {
      $s.textContent = err.message;
    }
  };
}

// ---------- boot ----------

(async () => {
  try {
    config = await api("/api/config");
  } catch (err) {
    showError(err);
    return;
  }
  if (config.mock) {
    const b = document.getElementById("banner");
    b.hidden = false;
    b.textContent = "Mock mode: questions and feedback are canned placeholders. Set ANTHROPIC_API_KEY and run `npm start` for the real thing.";
  }
  window.addEventListener("hashchange", route);
  route();
})();
