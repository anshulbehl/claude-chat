import { loadSessions, saveSessions } from "../sessions.js";
import { normalizeMessageContent } from "../messages.js";

/**
 * Setup sessions API routes
 * @param {Object} app - Express app instance
 */
export function setupSessionsRoutes(app) {
  /**
   * GET /api/sessions
   * Returns all sessions sorted by last updated (newest first)
   */
  app.get("/api/sessions", async (_req, res) => {
    try {
      const sessions = await loadSessions();
      const list = Object.values(sessions).sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
      );
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/sessions/:id/messages
   * Get a session's messages (with backward compatibility for old format)
   */
  app.get("/api/sessions/:id/messages", async (req, res) => {
    try {
      const sessions = await loadSessions();
      const session = sessions[req.params.id];
      const messages = session?.messages || [];

      // Normalize all messages to new format
      const normalizedMessages = messages.map(normalizeMessageContent);

      res.json(normalizedMessages);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/sessions/:id
   * Delete a session
   */
  app.delete("/api/sessions/:id", async (req, res) => {
    try {
      const sessions = await loadSessions();
      delete sessions[req.params.id];
      await saveSessions(sessions);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
