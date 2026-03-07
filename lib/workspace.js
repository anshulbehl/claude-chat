import { mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./config.js";

/**
 * Get the workspace directory path for a session
 * @param {string} sessionId - The session ID
 * @returns {string} Full path to the session's workspace directory
 */
export function getWorkspacePath(sessionId) {
  return join(DATA_DIR, sessionId, "workspace");
}

/**
 * Ensure the workspace directory exists for a session
 * @param {string} sessionId - The session ID
 * @returns {string} Full path to the created/existing workspace directory
 */
export function ensureWorkspaceExists(sessionId) {
  const workspacePath = getWorkspacePath(sessionId);
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}
