// Tiny JSON-file persistence under ./data (gitignored).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || path.join(here, "..", "data");
const DAYS = path.join(DATA, "days");
const SESSIONS = path.join(DATA, "sessions");

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

async function listJson(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export const getProfile = () => readJson(path.join(DATA, "profile.json"));
export const saveProfile = (p) => writeJson(path.join(DATA, "profile.json"), p);

export const getDay = (date) => readJson(path.join(DAYS, `${date}.json`));
export const saveDay = (day) => writeJson(path.join(DAYS, `${day.date}.json`), day);

export async function listDays() {
  const files = await listJson(DAYS);
  return Promise.all(files.map((f) => readJson(path.join(DAYS, f))));
}

export const getSession = (id) => readJson(path.join(SESSIONS, `${id}.json`));
export const saveSession = (s) => writeJson(path.join(SESSIONS, `${s.id}.json`), s);

export async function listSessions() {
  const files = await listJson(SESSIONS);
  return Promise.all(files.map((f) => readJson(path.join(SESSIONS, f))));
}
