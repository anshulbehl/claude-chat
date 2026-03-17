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
  app.get("/api/sessions", (_req, res) => {
    const sessions = loadSessions();
    const list = Object.values(sessions).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
    res.json(list);
  });

  /**
   * GET /api/sessions/:id/messages
   * Get a session's messages (with backward compatibility for old format)
   */
  app.get("/api/sessions/:id/messages", (req, res) => {
    const sessions = loadSessions();
    const session = sessions[req.params.id];
    const messages = session?.messages || [];

    // Normalize all messages to new format
    const normalizedMessages = messages.map(normalizeMessageContent);

    res.json(normalizedMessages);
  });

  /**
   * DELETE /api/sessions/:id
   * Delete a session
   */
  app.delete("/api/sessions/:id", (req, res) => {
    const sessions = loadSessions();
    delete sessions[req.params.id];
    saveSessions(sessions);
    res.json({ ok: true });
  });

  /**
   * PATCH /api/sessions/:id
   * Update session metadata (pinned, tags)
   */
  app.patch("/api/sessions/:id", (req, res) => {
    const sessions = loadSessions();
    const session = sessions[req.params.id];
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (typeof req.body.pinned === "boolean") {
      session.pinned = req.body.pinned;
    }
    if (Array.isArray(req.body.tags)) {
      session.tags = req.body.tags
        .map(t => typeof t === "string" ? t.trim().toLowerCase().slice(0, 30) : "")
        .filter(t => t.length > 0);
    }

    saveSessions(sessions);
    res.json({ ok: true });
  });
}
