// In-browser "backend": the same routes the UI used to call over HTTP,
// implemented on top of localStorage and direct Anthropic API calls.
import { CATEGORIES, DEFAULT_PROFILE, dailyPlan } from "./prompts.js";
import { isMock, generateCategory, interviewerReply, scoreSession, PLANS, DEFAULT_PLAN } from "./claude.js";
import * as store from "./store.js";

const ORDER = ["guesstimate", "rca", "product_design"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in India, YYYY-MM-DD. */
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const istDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const httpError = (status, message) => Object.assign(new Error(message), { status });

const profile = () => store.getProfile()?.text || DEFAULT_PROFILE;

const publicQuestion = (q) => {
  const { brief, ...rest } = q;
  return rest;
};

function overallScore(category, result) {
  let total = 0;
  let weight = 0;
  for (const d of CATEGORIES[category].dimensions) {
    const got = result.dimensions.find((x) => x.key === d.key);
    if (!got) continue;
    total += got.score * d.weight;
    weight += d.weight;
  }
  return weight ? Math.round((total / weight) * 10) / 10 : 0;
}

// ---------- Config, profile, settings ----------

function config() {
  const settings = store.getSettings();
  return {
    mock: !!settings.mock,
    hasKey: !!settings.apiKey,
    today: todayIST(),
    categories: Object.fromEntries(
      ORDER.map((k) => [k, {
        label: CATEGORIES[k].label,
        targetMinutes: CATEGORIES[k].targetMinutes,
        dimensions: CATEGORIES[k].dimensions.map(({ key, label, weight }) => ({ key, label, weight })),
      }]),
    ),
  };
}

function saveProfile({ text }) {
  text = String(text || "").trim();
  if (!text) throw httpError(400, "Profile cannot be empty.");
  store.saveProfile({ text, updatedAt: new Date().toISOString() });
  return { text };
}

function getSettings() {
  const s = store.getSettings();
  const usage = store.getUsage();
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    mock: !!s.mock,
    hasKey: !!s.apiKey,
    keyHint: s.apiKey ? `…${s.apiKey.slice(-4)}` : "",
    workspaceId: s.workspaceId || "",
    plan: PLANS[s.plan] ? s.plan : DEFAULT_PLAN,
    plans: Object.entries(PLANS).map(([key, p]) => ({ key, label: p.label, detail: p.detail, monthly: p.monthly })),
    usage: {
      cost: usage.cost,
      calls: usage.calls,
      projected: (usage.cost / dayOfMonth) * daysInMonth,
    },
  };
}

function saveSettings(body) {
  const s = store.getSettings();
  if ("apiKey" in body) s.apiKey = String(body.apiKey || "").trim();
  if ("workspaceId" in body) s.workspaceId = String(body.workspaceId || "").trim();
  if ("mock" in body) s.mock = !!body.mock;
  if ("plan" in body && PLANS[body.plan]) s.plan = body.plan;
  store.saveSettings(s);
  return getSettings();
}

// ---------- Daily questions ----------

const generating = new Map(); // date -> Promise, so double clicks don't double-generate

async function generateDay(date) {
  const plan = dailyPlan(date);
  const prof = profile();
  const recent = store.listDays()
    .filter((d) => d.date !== date)
    .slice(-30)
    .flatMap((d) => d.questions.map((q) => `${CATEGORIES[q.category].label}: ${q.prompt}`));

  const batches = await Promise.all(ORDER.map((cat) => generateCategory(cat, plan[cat], prof, recent)));
  const questions = batches.flatMap((qs, i) =>
    qs.map((q, j) => ({ ...q, id: `${ORDER[i]}-${j + 1}`, category: ORDER[i] })),
  );
  const day = { date, createdAt: new Date().toISOString(), mock: isMock(), questions };
  store.saveDay(day);
  return day;
}

function dayView(day) {
  const sessions = store.listSessions().filter((s) => s.date === day.date);
  return {
    date: day.date,
    questions: day.questions.map((q) => {
      const mine = sessions.filter((s) => s.qid === q.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const scored = mine.filter((s) => s.result);
      const best = scored.length ? Math.max(...scored.map((s) => s.result.overall)) : null;
      const open = mine.findLast((s) => !s.result);
      return { ...publicQuestion(q), attempts: scored.length, best, openSession: open?.id || null, lastScored: scored.at(-1)?.id || null };
    }),
  };
}

function listDays() {
  const sessions = store.listSessions();
  return store.listDays().map((d) => ({
    date: d.date,
    total: d.questions.length,
    done: new Set(sessions.filter((s) => s.date === d.date && s.result).map((s) => s.qid)).size,
  })).reverse();
}

function getDay(date) {
  if (!DATE_RE.test(date)) throw httpError(400, "Bad date");
  const day = store.getDay(date);
  if (!day) throw httpError(404, "No questions for this date yet");
  return dayView(day);
}

async function generate(date, force) {
  if (!DATE_RE.test(date)) throw httpError(400, "Bad date");
  const existing = store.getDay(date);
  if (existing && !force) return dayView(existing);
  if (!generating.has(date)) {
    generating.set(date, generateDay(date).finally(() => generating.delete(date)));
  }
  return dayView(await generating.get(date));
}

// ---------- Practice sessions ----------

function loadSession(id) {
  const s = store.getSession(id);
  if (!s) throw httpError(404, "Session not found");
  return s;
}

function sessionView(s) {
  return {
    id: s.id,
    date: s.date,
    qid: s.qid,
    question: s.result ? s.question : publicQuestion(s.question),
    stage: s.stage,
    turns: s.turns,
    notes: s.notes,
    startedAt: s.startedAt,
    answerStartedAt: s.answerStartedAt,
    endedAt: s.endedAt,
    result: s.result,
  };
}

function createSession({ date, qid, fresh }) {
  const question = store.getDay(date)?.questions.find((q) => q.id === qid);
  if (!question) throw httpError(404, "Question not found");
  if (!fresh) {
    const open = store.listSessions().filter((s) => s.date === date && s.qid === qid && !s.result).at(-1);
    if (open) return sessionView(open);
  }
  const s = {
    id: crypto.randomUUID(),
    date,
    qid,
    question,
    stage: "clarify",
    turns: [{ role: "assistant", stage: "clarify", text: question.prompt, at: new Date().toISOString() }],
    notes: "",
    startedAt: new Date().toISOString(),
  };
  store.saveSession(s);
  return sessionView(s);
}

async function sendMessage(id, body) {
  const s = loadSession(id);
  if (s.result) throw httpError(409, "This session is already scored.");
  const text = String(body?.text || "").trim();
  if (!text) throw httpError(400, "Message is empty.");
  if (text.length > 8000) throw httpError(400, "Message is too long (8000 characters max).");

  const turns = [...s.turns, { role: "user", stage: s.stage, text, at: new Date().toISOString() }];
  // The API needs the conversation to start with a user turn; the opening
  // question is in the system prompt, so drop it here.
  const reply = await interviewerReply(s.question, profile(), turns.slice(1));
  s.turns = [...turns, { role: "assistant", stage: s.stage, text: reply, at: new Date().toISOString() }];
  store.saveSession(s);
  return sessionView(s);
}

function advanceStage(id) {
  const s = loadSession(id);
  if (s.result) throw httpError(409, "This session is already scored.");
  if (s.stage === "clarify") {
    s.stage = "answer";
    s.answerStartedAt = new Date().toISOString();
    store.saveSession(s);
  }
  return sessionView(s);
}

function saveNotes(id, body) {
  const s = loadSession(id);
  s.notes = String(body?.notes || "").slice(0, 20000);
  store.saveSession(s);
  return { ok: true };
}

async function score(id) {
  const s = loadSession(id);
  if (s.result) return sessionView(s);
  if (!s.turns.some((t) => t.role === "user")) throw httpError(400, "Say something first — there's nothing to score yet.");

  const endedAt = new Date();
  const elapsedSec = (endedAt - new Date(s.startedAt)) / 1000;
  const transcript = s.turns
    .map((t) => `${t.role === "user" ? `CANDIDATE [${t.stage === "answer" ? "answer phase" : "clarifying phase"}]` : "INTERVIEWER"}: ${t.text}`)
    .join("\n\n");
  const result = await scoreSession(s.question, transcript, elapsedSec, s.notes);
  for (const d of result.dimensions) d.score = Math.max(0, Math.min(10, Math.round(d.score)));
  result.overall = overallScore(s.question.category, result);
  result.elapsedSec = Math.round(elapsedSec);
  result.clarifyingCount = s.turns.filter((t) => t.role === "user" && t.stage === "clarify").length;
  s.result = result;
  s.endedAt = endedAt.toISOString();
  s.stage = "done";
  store.saveSession(s);
  return sessionView(s);
}

// ---------- Progress ----------

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

function progress() {
  const scored = store.listSessions()
    .filter((s) => s.result)
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));

  const byCategory = {};
  for (const cat of ORDER) {
    const list = scored.filter((s) => s.question.category === cat);
    const overalls = list.map((s) => s.result.overall);
    byCategory[cat] = {
      label: CATEGORIES[cat].label,
      count: list.length,
      avg: avg(overalls),
      recentAvg: avg(overalls.slice(-4)),
      dims: CATEGORIES[cat].dimensions.map((d) => ({
        key: d.key,
        label: d.label,
        avg: avg(list.map((s) => s.result.dimensions.find((x) => x.key === d.key)?.score).filter((x) => x != null)),
      })),
    };
  }

  // Consecutive IST days with at least one scored attempt; today not yet practised doesn't break it.
  const practiceDays = new Set(scored.map((s) => istDay(s.endedAt)));
  const today = todayIST();
  let streak = 0;
  for (let d = new Date(`${today}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() - 1)) {
    const key = d.toISOString().slice(0, 10);
    if (practiceDays.has(key)) streak++;
    else if (key !== today) break;
  }

  return {
    total: scored.length,
    streak,
    byCategory,
    recent: scored.slice(-15).reverse().map((s) => ({
      id: s.id,
      date: s.date,
      category: s.question.category,
      title: s.question.title,
      overall: s.result.overall,
      verdict: s.result.verdict,
    })),
  };
}

// ---------- Router ----------

const ROUTES = [
  ["GET", /^\/api\/config$/, () => config()],
  ["GET", /^\/api\/profile$/, () => ({ text: profile() })],
  ["PUT", /^\/api\/profile$/, (m, body) => saveProfile(body)],
  ["GET", /^\/api\/settings$/, () => getSettings()],
  ["PUT", /^\/api\/settings$/, (m, body) => saveSettings(body)],
  ["GET", /^\/api\/days$/, () => listDays()],
  ["GET", /^\/api\/day\/([^/]+)$/, (m) => getDay(m[1])],
  ["POST", /^\/api\/day\/([^/]+)\/generate$/, (m, body, q) => generate(m[1], q.get("force"))],
  ["POST", /^\/api\/sessions$/, (m, body) => createSession(body || {})],
  ["GET", /^\/api\/sessions\/([^/]+)$/, (m) => sessionView(loadSession(m[1]))],
  ["POST", /^\/api\/sessions\/([^/]+)\/messages$/, (m, body) => sendMessage(m[1], body)],
  ["POST", /^\/api\/sessions\/([^/]+)\/stage$/, (m) => advanceStage(m[1])],
  ["PUT", /^\/api\/sessions\/([^/]+)\/notes$/, (m, body) => saveNotes(m[1], body)],
  ["POST", /^\/api\/sessions\/([^/]+)\/score$/, (m) => score(m[1])],
  ["GET", /^\/api\/progress$/, () => progress()],
];

export async function api(path, opts = {}) {
  const method = opts.method || "GET";
  const url = new URL(path, "http://local");
  for (const [m, re, handler] of ROUTES) {
    const match = m === method && url.pathname.match(re);
    if (match) {
      try {
        return await handler(match, opts.body, url.searchParams);
      } catch (err) {
        if (!err.status || err.status >= 500) console.error(err);
        throw err;
      }
    }
  }
  throw httpError(404, `Unknown route ${method} ${path}`);
}

export { store };
