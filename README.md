# Claude Chat Client

A lightweight web-based chat interface that connects to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI, giving you a claude.ai-like experience powered by your existing Claude Code subscription.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Node.js 18+

## Setup

```bash
npm install
npm start
```

Then open http://localhost:3000 in your browser.

For development with auto-reload:

```bash
npm run dev
```

## Features

- Chat with Claude through a clean web UI
- Model selection (Opus, Sonnet, Haiku, and specific versions)
- Streaming responses with markdown rendering and syntax highlighting
- Session history with persistence across restarts
- Web search and web fetch tool access
- Cost tracking per message

## How It Works

The server spawns the `claude` CLI in non-interactive mode for each message, streaming the response back via Server-Sent Events. Sessions are stored locally in `~/.claude-chat/data/` and conversations use the Claude Code session resume feature for multi-turn context.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |

## Notes

- Requires an active Claude Code subscription (Max, Pro, or API credits)
- The CLI runs in a sandboxed directory (`~/.claude-chat/sandbox/`) with no access to your codebase
- Only web search and web fetch tools are enabled -- no file system or code editing access
- Model availability depends on your Claude Code plan
