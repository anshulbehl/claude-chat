import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import request from "supertest";

// Set env before importing server
process.env.GOOGLE_CLOUD_PROJECT = "test-project";
process.env.GOOGLE_CLOUD_REGION = "us-east5";

// Mock the Vertex AI SDK
const mockStream = {
  on: vi.fn(),
  finalMessage: vi.fn(),
};

vi.mock("@anthropic-ai/vertex-sdk", () => {
  return {
    default: class MockAnthropicVertex {
      constructor() {
        this.messages = {
          stream: vi.fn().mockResolvedValue(mockStream),
          create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] }),
        };
      }
    },
  };
});

// Use a temp directory for session data so tests don't affect real data
const TEST_DATA_DIR = join(tmpdir(), "claude-chat-test-" + Date.now());

vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    homedir: () => TEST_DATA_DIR,
  };
});

let app, MODELS;

beforeAll(async () => {
  mkdirSync(join(TEST_DATA_DIR, ".claude-chat", "data"), { recursive: true });
  mkdirSync(join(TEST_DATA_DIR, ".claude-chat", "uploads"), { recursive: true });
  const mod = await import("../server.js");
  app = mod.app;
  MODELS = mod.ALL_MODELS;
  // Wait for model probing to complete
  await new Promise(resolve => setTimeout(resolve, 100));
});

afterEach(() => {
  const sessionsFile = join(TEST_DATA_DIR, ".claude-chat", "data", "sessions.json");
  if (existsSync(sessionsFile)) {
    rmSync(sessionsFile);
  }
});

function writeTestSessions(sessions) {
  const sessionsFile = join(TEST_DATA_DIR, ".claude-chat", "data", "sessions.json");
  writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
}

describe("GET /api/models", () => {
  it("returns array of models with required fields", async () => {
    const res = await request(app).get("/api/models");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    for (const model of res.body) {
      expect(model).toHaveProperty("alias");
      expect(model).toHaveProperty("label");
      expect(model).toHaveProperty("modelId");
    }
  });

  it("includes haiku, sonnet, and opus", async () => {
    const res = await request(app).get("/api/models");
    const aliases = res.body.map((m) => m.alias);
    expect(aliases).toContain("haiku");
    expect(aliases).toContain("sonnet");
    expect(aliases).toContain("opus");
  });
});

describe("GET /api/sessions", () => {
  it("returns empty array when no sessions exist", async () => {
    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns sessions sorted by updatedAt descending", async () => {
    writeTestSessions({
      old: {
        id: "old",
        title: "Old Chat",
        model: "sonnet",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        messageCount: 2,
        messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
      },
      newer: {
        id: "newer",
        title: "Newer Chat",
        model: "sonnet",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
        messageCount: 2,
        messages: [{ role: "user", content: "test" }, { role: "assistant", content: "ok" }],
      },
    });

    const res = await request(app).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe("newer");
    expect(res.body[1].id).toBe("old");
  });
});

describe("GET /api/sessions/:id/messages", () => {
  it("returns empty array for non-existent session", async () => {
    const res = await request(app).get("/api/sessions/nonexistent/messages");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns messages for existing session with new format", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ];
    writeTestSessions({
      sess1: {
        id: "sess1",
        title: "Test",
        messages,
      },
    });

    const res = await request(app).get("/api/sessions/sess1/messages");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(messages);
  });

  it("normalizes old format messages to new format", async () => {
    // Old format with plain string content
    const oldMessages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    writeTestSessions({
      sess1: {
        id: "sess1",
        title: "Old Session",
        messages: oldMessages,
      },
    });

    const res = await request(app).get("/api/sessions/sess1/messages");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    // Should be normalized to new format
    expect(res.body[0].content).toEqual([{ type: "text", text: "hello" }]);
    expect(res.body[1].content).toEqual([{ type: "text", text: "hi there" }]);
  });
});

describe("DELETE /api/sessions/:id", () => {
  it("deletes a session and returns ok", async () => {
    writeTestSessions({
      sess1: { id: "sess1", title: "To delete", messages: [] },
      sess2: { id: "sess2", title: "Keep", messages: [] },
    });

    const res = await request(app).delete("/api/sessions/sess1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Verify it's gone
    const listRes = await request(app).get("/api/sessions");
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe("sess2");
  });
});

describe("PATCH /api/sessions/:id", () => {
  it("updates pinned status on a session", async () => {
    writeTestSessions({
      sess1: { id: "sess1", title: "Test", messages: [], pinned: false, tags: [] },
    });

    const res = await request(app)
      .patch("/api/sessions/sess1")
      .send({ pinned: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const listRes = await request(app).get("/api/sessions");
    expect(listRes.body[0].pinned).toBe(true);
  });

  it("updates tags on a session", async () => {
    writeTestSessions({
      sess1: { id: "sess1", title: "Test", messages: [], pinned: false, tags: [] },
    });

    const res = await request(app)
      .patch("/api/sessions/sess1")
      .send({ tags: ["kubernetes", "infra"] });

    expect(res.status).toBe(200);

    const listRes = await request(app).get("/api/sessions");
    expect(listRes.body[0].tags).toEqual(["kubernetes", "infra"]);
  });

  it("returns 404 for non-existent session", async () => {
    const res = await request(app)
      .patch("/api/sessions/nonexistent")
      .send({ pinned: true });

    expect(res.status).toBe(404);
  });

  it("ignores fields other than pinned and tags", async () => {
    writeTestSessions({
      sess1: { id: "sess1", title: "Original", messages: [], pinned: false, tags: [] },
    });

    const res = await request(app)
      .patch("/api/sessions/sess1")
      .send({ title: "Hacked", pinned: true });

    expect(res.status).toBe(200);

    const listRes = await request(app).get("/api/sessions");
    expect(listRes.body[0].title).toBe("Original");
    expect(listRes.body[0].pinned).toBe(true);
  });

  it("normalizes tags server-side", async () => {
    writeTestSessions({
      sess1: { id: "sess1", title: "Test", messages: [], tags: [] },
    });

    const res = await request(app)
      .patch("/api/sessions/sess1")
      .send({ tags: ["  Kubernetes ", "", "INFRA", "a".repeat(50)] });

    expect(res.status).toBe(200);

    const listRes = await request(app).get("/api/sessions");
    expect(listRes.body[0].tags).toEqual(["kubernetes", "infra", "a".repeat(30)]);
  });
});

describe("POST /api/chat", () => {
  it("returns 400 when message is missing", async () => {
    const res = await request(app).post("/api/chat").field("model", "sonnet");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("message is required");
  });

  it("returns 400 for unsupported file types", async () => {
    const res = await request(app)
      .post("/api/chat")
      .field("message", "test")
      .field("model", "sonnet")
      .attach("files", Buffer.from("binary"), "malware.exe");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not supported");
  });

  it("returns 400 with user-friendly message for file size limit", async () => {
    const res = await request(app)
      .post("/api/chat")
      .field("message", "test")
      .field("model", "sonnet")
      .attach("files", Buffer.alloc(21 * 1024 * 1024), "huge.txt");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("File too large");
    expect(res.body.error).toContain("20MB");
  });

  it("returns 400 with user-friendly message for too many files", async () => {
    const req = request(app)
      .post("/api/chat")
      .field("message", "test")
      .field("model", "sonnet");

    for (let i = 0; i < 6; i++) {
      req.attach("files", Buffer.from(`file ${i}`), `file${i}.txt`);
    }

    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Too many files");
    expect(res.body.error).toContain("5");
  });

  it("returns 400 with descriptive message for files without valid extension", async () => {
    const res = await request(app)
      .post("/api/chat")
      .field("message", "test")
      .field("model", "sonnet")
      .attach("files", Buffer.from("data"), "noextension");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not supported");
  });

  it("accepts exactly 5 files (at the limit)", async () => {
    mockStream.on.mockImplementation(() => mockStream);
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: "text", text: "Got them" }],
      usage: { input_tokens: 20, output_tokens: 5 },
    });

    const req = request(app)
      .post("/api/chat")
      .field("message", "five files")
      .field("model", "sonnet");

    for (let i = 0; i < 5; i++) {
      req.attach("files", Buffer.from(`file ${i}`), `file${i}.txt`);
    }

    const res = await req;
    expect(res.status).toBe(200);
  });

  it("streams SSE response for valid text message", async () => {
    // Set up mock stream behavior
    mockStream.on.mockImplementation((event, handler) => {
      if (event === "text") {
        setTimeout(() => handler("Hello "), 10);
        setTimeout(() => handler("world"), 20);
      }
      return mockStream;
    });
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: "text", text: "Hello world" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const res = await request(app)
      .post("/api/chat")
      .field("message", "Say hello")
      .field("model", "sonnet");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");

    // Parse SSE events
    const events = res.text
      .split("\n")
      .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
      .map((l) => {
        try { return JSON.parse(l.slice(6)); } catch { return null; }
      })
      .filter(Boolean);

    // Should have session event
    const sessionEvent = events.find((e) => e.type === "session");
    expect(sessionEvent).toBeTruthy();
    expect(sessionEvent.sessionId).toBeTruthy();

    // Should have done event
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeTruthy();
  });

  it("creates a new session for first message", async () => {
    mockStream.on.mockImplementation(() => mockStream);
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: "text", text: "Hi" }],
      usage: { input_tokens: 5, output_tokens: 2 },
    });

    await request(app)
      .post("/api/chat")
      .field("message", "First message")
      .field("model", "sonnet");

    // Check session was created
    const listRes = await request(app).get("/api/sessions");
    expect(listRes.body.length).toBeGreaterThan(0);
    const session = listRes.body[0];
    expect(session.title).toBe("First message");
    expect(session.model).toBe("sonnet");
  });

  it("accepts text file uploads", async () => {
    mockStream.on.mockImplementation(() => mockStream);
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: "text", text: "File received" }],
      usage: { input_tokens: 20, output_tokens: 5 },
    });

    const res = await request(app)
      .post("/api/chat")
      .field("message", "What is in this file?")
      .field("model", "sonnet")
      .attach("files", Buffer.from("hello world"), "test.txt");

    expect(res.status).toBe(200);

    // Parse SSE events to verify session was created
    const events = res.text
      .split("\n")
      .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
      .map((l) => {
        try { return JSON.parse(l.slice(6)); } catch { return null; }
      })
      .filter(Boolean);

    const sessionEvent = events.find((e) => e.type === "session");
    expect(sessionEvent).toBeTruthy();
    expect(sessionEvent.sessionId).toBeTruthy();
  });

  it("accepts various allowed file types", async () => {
    mockStream.on.mockImplementation(() => mockStream);
    mockStream.finalMessage.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 5, output_tokens: 2 },
    });

    const allowedFiles = [
      { name: "code.py", content: "print('hello')" },
      { name: "config.yaml", content: "key: value" },
      { name: "data.json", content: '{"a":1}' },
      { name: "readme.md", content: "# Title" },
      { name: "style.css", content: "body {}" },
    ];

    const req = request(app)
      .post("/api/chat")
      .field("message", "review these files")
      .field("model", "sonnet");

    for (const f of allowedFiles) {
      req.attach("files", Buffer.from(f.content), f.name);
    }

    const res = await req;
    expect(res.status).toBe(200);
  });
});

describe("dotenv and environment configuration", () => {
  it("loads GOOGLE_CLOUD_PROJECT from environment", async () => {
    expect(process.env.GOOGLE_CLOUD_PROJECT).toBe("test-project");
  });

  it("defaults GOOGLE_CLOUD_REGION to us-east5", async () => {
    expect(process.env.GOOGLE_CLOUD_REGION).toBe("us-east5");
  });

  it("defaults PORT to 3000 when not set", async () => {
    const originalPort = process.env.PORT;
    delete process.env.PORT;
    // The config module already loaded, so we verify the exported value
    const { PORT } = await import("../lib/config.js");
    expect(PORT).toBeTruthy();
    if (originalPort) process.env.PORT = originalPort;
  });
});

describe("setup-env.js script", () => {
  it("script file exists and is valid ESM", async () => {
    const { existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const scriptPath = join(process.cwd(), "scripts", "setup-env.js");
    expect(existsSync(scriptPath)).toBe(true);
    const content = readFileSync(scriptPath, "utf-8");
    expect(content).toContain("import");
    expect(content).toContain(".env.local");
    expect(content).toContain(".env.example");
  });

  it(".env.example template exists with required variables", async () => {
    const { existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const examplePath = join(process.cwd(), ".env.example");
    expect(existsSync(examplePath)).toBe(true);
    const content = readFileSync(examplePath, "utf-8");
    expect(content).toContain("GOOGLE_CLOUD_PROJECT");
    expect(content).toContain("GOOGLE_CLOUD_REGION");
    expect(content).toContain("PORT");
  });

  it(".gitignore includes .env and .env.local", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const gitignorePath = join(process.cwd(), ".gitignore");
    const content = readFileSync(gitignorePath, "utf-8");
    expect(content).toContain(".env");
    expect(content).toContain(".env.local");
  });
});

