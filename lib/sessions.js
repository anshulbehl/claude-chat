import { readFile, writeFile } from "fs/promises";
import { SESSIONS_FILE } from "./config.js";

/**
 * Load all sessions from the sessions file
 * @returns {Object} Object containing all sessions, keyed by session ID
 */
export async function loadSessions() {
  try {
    return JSON.parse(await readFile(SESSIONS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Save sessions to the sessions file
 * @param {Object} sessions - Object containing all sessions, keyed by session ID
 */
export async function saveSessions(sessions) {
  await writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}
