import express from "express";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Clear CLAUDECODE env var so the CLI doesn't think it's a nested session
delete process.env.CLAUDECODE;

const app = express();
const PORT = process.env.PORT || 3000;

// Sandbox directory - empty dir so Claude has no repo context
const SANDBOX_DIR = join(homedir(), ".claude-chat", "sandbox");
mkdirSync(SANDBOX_DIR, { recursive: true });

// Session index storage
const DATA_DIR = join(homedir(), ".claude-chat", "data");
mkdirSync(DATA_DIR, { recursive: true });
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

function loadSessions() {
  if (!existsSync(SESSIONS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SESSIONS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveSessions(sessions) {
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

app.use(express.json());
app.use(express.static("public"));

// Available models - populated on startup by probing the CLI
const MODELS = [
  { alias: "claude-opus-4-6", label: "Opus 4.6", description: "Latest, most intelligent" },
  { alias: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "Latest, fast and capable" },
  { alias: "sonnet", label: "Sonnet", description: "Best for everyday tasks" },
  { alias: "opus", label: "Opus", description: "Most capable for complex work" },
  { alias: "haiku", label: "Haiku", description: "Haiku 4.5 - Fastest for quick answers" },
  { alias: "claude-opus-4-1-20250620", label: "Opus 4.1", description: "Opus 4.1 - Legacy" },
  { alias: "claude-sonnet-4-5-20241022", label: "Sonnet 4.5", description: "Sonnet 4.5 - Previous generation" },
];

let resolvedModels = null;

async function probeModels() {
  const results = [];
  for (const m of MODELS) {
    try {
      const result = await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.CLAUDECODE;
        const child = spawn("claude", [
          "-p", "hi",
          "--model", m.alias,
          "--output-format", "stream-json",
          "--verbose",
          "--max-turns", "1",
          "--strict-mcp-config",
        ], { cwd: SANDBOX_DIR, env, stdio: ["ignore", "pipe", "pipe"] });

        let output = "";
        child.stdout.on("data", (d) => { output += d.toString(); });
        child.on("close", (code) => {
          // Extract model ID from init event
          try {
            const initLine = output.split("\n").find((l) => l.includes('"subtype":"init"'));
            if (initLine) {
              const init = JSON.parse(initLine);
              resolve({ ...m, modelId: init.model });
              return;
            }
          } catch {}
          // If we got a result, the model works even if we can't parse init
          if (code === 0) {
            resolve({ ...m, modelId: m.alias });
          } else {
            reject(new Error(`Model ${m.alias} not available`));
          }
        });
        child.on("error", reject);
        // Timeout after 30s
        setTimeout(() => { child.kill(); reject(new Error("timeout")); }, 30000);
      });
      results.push(result);
    } catch {
      console.log(`Model ${m.alias} not available, skipping`);
    }
  }
  resolvedModels = results;
  console.log("Available models:", resolvedModels.map((m) => `${m.alias} (${m.modelId})`).join(", "));
}

// Probe models on startup (non-blocking)
probeModels();

// Get available models
app.get("/api/models", (_req, res) => {
  if (resolvedModels) {
    res.json(resolvedModels);
  } else {
    // Still probing, return defaults
    res.json(MODELS.map((m) => ({ ...m, modelId: m.alias })));
  }
});

// List all chat sessions
app.get("/api/sessions", (_req, res) => {
  const sessions = loadSessions();
  const list = Object.values(sessions).sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );
  res.json(list);
});

// Get a session's messages (from our local store)
app.get("/api/sessions/:id/messages", (req, res) => {
  const sessions = loadSessions();
  const session = sessions[req.params.id];
  res.json(session?.messages || []);
});

// Delete a session
app.delete("/api/sessions/:id", (req, res) => {
  const sessions = loadSessions();
  delete sessions[req.params.id];
  saveSessions(sessions);
  res.json({ ok: true });
});

// Chat endpoint - streams response via SSE
app.post("/api/chat", async (req, res) => {
  const { message, sessionId, model } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Send initial comment to establish the stream
  res.write(": connected\n\n");

  const sessions = loadSessions();
  let currentSessionId = sessionId;
  let isNewSession = !sessionId;

  // Build CLI args
  const args = [
    "-p", message,
    "--model", model || "sonnet",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--max-turns", "3",
    "--strict-mcp-config",
    "--tools", "WebSearch,WebFetch",
    "--allowed-tools", "WebSearch,WebFetch",
    "--dangerously-skip-permissions",
    "--system-prompt", "You are Claude, a helpful AI assistant made by Anthropic. You are being accessed through a chat interface, similar to claude.ai. Have a natural conversation. Be helpful, harmless, and honest. Use markdown formatting when appropriate. You are NOT Claude Code, a CLI tool, or a terminal assistant. You do not have access to files, bash, or code editing tools. You can search the web and fetch web pages to answer questions with up-to-date information. You are a general-purpose conversational AI assistant.",
  ];

  if (sessionId) {
    args.push("--resume", sessionId);
  }

  console.log("Spawning claude for model:", model || "sonnet");

  // Spawn claude CLI
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const child = spawn("claude", args, {
    cwd: SANDBOX_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let fullText = "";
  let buffer = "";
  let streamFinished = false;

  res.on("close", () => {
    if (!streamFinished) {
      child.kill("SIGTERM");
    }
  });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);

        if (event.type === "system" && event.subtype === "init") {
          currentSessionId = event.session_id;
          res.write(
            `data: ${JSON.stringify({ type: "session", sessionId: currentSessionId })}\n\n`
          );
        } else if (event.type === "stream_event") {
          // Token-by-token streaming deltas
          const apiEvent = event.event;
          if (
            apiEvent?.type === "content_block_delta" &&
            apiEvent.delta?.type === "text_delta"
          ) {
            const text = apiEvent.delta.text;
            fullText += text;
            res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
          }
        } else if (event.type === "assistant") {
          // Full assistant message (fallback if no streaming deltas received)
          const text =
            event.message?.content
              ?.filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("") || "";
          if (text && !fullText) {
            fullText = text;
            res.write(
              `data: ${JSON.stringify({ type: "text", text })}\n\n`
            );
          }
        } else if (event.type === "result") {
          // Final result
          if (!fullText && event.result) {
            fullText = event.result;
            res.write(
              `data: ${JSON.stringify({ type: "text", text: fullText })}\n\n`
            );
          }
          res.write(
            `data: ${JSON.stringify({
              type: "done",
              cost: event.total_cost_usd,
              model: model || "sonnet",
            })}\n\n`
          );
        }
      } catch {
        // Not JSON, skip
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    console.error("claude stderr:", chunk.toString());
  });

  child.on("close", (code) => {
    console.log(`claude exited with code ${code}, fullText length: ${fullText.length}`);
    streamFinished = true;

    // Update session index
    if (currentSessionId) {
      const reloadedSessions = loadSessions();
      const title =
        isNewSession && message
          ? message.slice(0, 80) + (message.length > 80 ? "..." : "")
          : reloadedSessions[currentSessionId]?.title || message.slice(0, 80);

      // Store messages locally
      const existingMessages =
        reloadedSessions[currentSessionId]?.messages || [];
      existingMessages.push(
        { role: "user", content: message },
        { role: "assistant", content: fullText }
      );

      reloadedSessions[currentSessionId] = {
        id: currentSessionId,
        title,
        model: model || "sonnet",
        createdAt:
          reloadedSessions[currentSessionId]?.createdAt ||
          new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: existingMessages.length,
        messages: existingMessages,
      };
      saveSessions(reloadedSessions);
    }

    try {
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      /* response already closed */
    }
  });

  child.on("error", (err) => {
    console.error("Failed to spawn claude:", err);
    streamFinished = true;
    try {
      res.write(
        `data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      /* response already closed */
    }
  });
});

app.listen(PORT, () => {
  console.log(`Claude Chat Client running at http://localhost:${PORT}`);
  console.log(`Sandbox directory: ${SANDBOX_DIR}`);
});
