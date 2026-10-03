// Browser storage: everything lives in this browser's localStorage.
// Export / import (Settings page) moves it between browsers.

const P = "pmpb:";
const DAY = `${P}day:`;
const SESSION = `${P}session:`;

function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    throw Object.assign(new Error(`Could not save to browser storage (${err.name}). Export your data from Settings and clear old days.`), { status: 507 });
  }
}

function listByPrefix(prefix) {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(prefix)) {
      const v = read(k);
      if (v) out.push(v);
    }
  }
  return out;
}

export const getSettings = () => read(`${P}settings`, {});
export const saveSettings = (s) => write(`${P}settings`, s);

export const getProfile = () => read(`${P}profile`);
export const saveProfile = (p) => write(`${P}profile`, p);

export const getDay = (date) => read(DAY + date);
export const saveDay = (day) => write(DAY + day.date, day);
export const listDays = () => listByPrefix(DAY).sort((a, b) => a.date.localeCompare(b.date));

export const getSession = (id) => read(SESSION + id);
export const saveSession = (s) => write(SESSION + s.id, s);
export const listSessions = () => listByPrefix(SESSION);

/** All app data except the API key. */
export function exportAll() {
  return {
    app: "pm-practice-bot",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: getProfile(),
    days: listDays(),
    sessions: listSessions(),
  };
}

export function importAll(data) {
  if (data?.app !== "pm-practice-bot") throw new Error("That file isn't a PM Practice export.");
  if (data.profile) saveProfile(data.profile);
  for (const d of data.days || []) saveDay(d);
  for (const s of data.sessions || []) saveSession(s);
  return { days: data.days?.length || 0, sessions: data.sessions?.length || 0 };
}
