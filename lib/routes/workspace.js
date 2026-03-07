import { existsSync, readdirSync, statSync, createReadStream } from "fs";
import { join, basename } from "path";
import { getWorkspacePath } from "../workspace.js";
import { getMediaType } from "../file-processor.js";

/**
 * Setup workspace API routes
 * @param {Object} app - Express app instance
 */
export function setupWorkspaceRoutes(app) {
  /**
   * GET /api/workspace/:sessionId/files
   * List all files in a session's workspace
   */
  app.get("/api/workspace/:sessionId/files", (req, res) => {
    const { sessionId } = req.params;
    const workspacePath = getWorkspacePath(sessionId);

    if (!existsSync(workspacePath)) {
      return res.json([]);
    }

    try {
      const files = readdirSync(workspacePath).map(filename => {
        const filePath = join(workspacePath, filename);
        const stats = statSync(filePath);
        return {
          name: filename,
          path: join("workspace", filename),
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      });
      res.json(files);
    } catch (err) {
      console.error("Failed to list workspace files:", err);
      res.status(500).json({ error: "Failed to list workspace files" });
    }
  });

  /**
   * GET /api/workspace/:sessionId/file?path=<relativePath>
   * Get a specific file from a session's workspace
   */
  app.get("/api/workspace/:sessionId/file", (req, res) => {
    const { sessionId } = req.params;
    const { path: relativePath } = req.query;

    if (!relativePath) {
      return res.status(400).json({ error: "path query parameter is required" });
    }

    // Security: ensure path is within workspace (prevent directory traversal)
    if (relativePath.includes("..") || relativePath.startsWith("/")) {
      return res.status(400).json({ error: "Invalid path" });
    }

    const workspacePath = getWorkspacePath(sessionId);
    const filePath = join(workspacePath, relativePath.replace(/^workspace\//, ""));

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    try {
      const stats = statSync(filePath);

      if (!stats.isFile()) {
        return res.status(400).json({ error: "Path is not a file" });
      }

      // Determine content type from extension
      const contentType = getMediaType(basename(filePath));

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", stats.size);
      res.setHeader("Content-Disposition", `inline; filename="${basename(filePath)}"`);

      // Stream file to response
      const stream = createReadStream(filePath);
      stream.pipe(res);
    } catch (err) {
      console.error("Failed to read workspace file:", err);
      res.status(500).json({ error: "Failed to read file" });
    }
  });
}
