export const TERMINAL_GATEWAY_VERSION = "2026-03-25-gateway-v1";

const TERMINAL_GATEWAY_CLIENT_SCRIPT = String.raw`
  import { FitAddon, Terminal, init } from "/dist/ghostty-web.js";

  const statusElement = document.getElementById("terminal-status");
  const terminalContainer = document.getElementById("terminal");
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const launchToken = hashParams.get("token");
  const sessionId = hashParams.get("session");

  function setStatus(label, state) {
    statusElement.textContent = label;
    statusElement.dataset.state = state;
  }

  if (!launchToken || !sessionId) {
    setStatus("Missing credentials", "error");
    throw new Error("Missing terminal session credentials");
  }

  await init();

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily:
      'Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    scrollback: 10000,
    theme: {
      background: "#09090b",
      foreground: "#fafafa",
    },
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  await term.open(terminalContainer);
  fitAddon.fit();
  if (typeof fitAddon.observeResize === "function") {
    fitAddon.observeResize();
  }

  let socket;
  let reconnectTimeoutId = null;

  function clearReconnectTimeout() {
    if (reconnectTimeoutId !== null) {
      window.clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  }

  function scheduleReconnect() {
    clearReconnectTimeout();
    reconnectTimeoutId = window.setTimeout(() => {
      reconnectTimeoutId = null;
      connect();
    }, 1000);
  }

  function buildWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL(protocol + "//" + window.location.host + "/ws");
    url.searchParams.set("token", launchToken);
    url.searchParams.set("session", sessionId);
    url.searchParams.set("cols", String(term.cols));
    url.searchParams.set("rows", String(term.rows));
    return url.toString();
  }

  function connect() {
    setStatus("Connecting…", "connecting");
    socket = new WebSocket(buildWebSocketUrl());

    socket.addEventListener("open", () => {
      setStatus("Connected", "connected");
    });

    socket.addEventListener("message", (event) => {
      term.write(event.data);
    });

    socket.addEventListener("error", () => {
      setStatus("Connection error", "error");
    });

    socket.addEventListener("close", () => {
      setStatus("Reconnecting…", "disconnected");
      scheduleReconnect();
    });
  }

  term.onData((data) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  });

  term.onResize(({ cols, rows }) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  window.addEventListener("resize", () => {
    fitAddon.fit();
  });

  window.addEventListener("beforeunload", () => {
    clearReconnectTimeout();
    socket?.close();
  });

  connect();
`;

const TERMINAL_PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0"
    />
    <title>Session Terminal</title>
    <style>
      :root {
        color-scheme: dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: #09090b;
        color: #fafafa;
      }

      .shell {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }

      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        padding: 12px 16px;
        background: rgba(9, 9, 11, 0.96);
        backdrop-filter: blur(12px);
      }

      .title {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.01em;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #a1a1aa;
        font-size: 12px;
      }

      .status::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #f59e0b;
        box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
      }

      .status[data-state="connected"]::before {
        background: #22c55e;
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
      }

      .status[data-state="error"]::before,
      .status[data-state="disconnected"]::before {
        background: #f43f5e;
        box-shadow: 0 0 0 2px rgba(244, 63, 94, 0.2);
      }

      #terminal {
        flex: 1;
        min-height: 0;
        padding: 12px;
        overflow: hidden;
      }

      #terminal canvas {
        display: block;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="toolbar">
        <div class="title">Session Terminal</div>
        <div class="status" data-state="connecting" id="terminal-status">
          Connecting…
        </div>
      </div>
      <div id="terminal"></div>
    </div>

    <script type="module">
${TERMINAL_GATEWAY_CLIENT_SCRIPT}
    </script>
  </body>
</html>
`;

const TERMINAL_GATEWAY_SCRIPT_LINES = [
  'import { createReadStream, existsSync, readFileSync } from "node:fs";',
  'import { createServer } from "node:http";',
  'import path from "node:path";',
  'import pty from "@lydell/node-pty";',
  'import { WebSocketServer } from "ws";',
  "",
  'const PORT = Number(process.env.OPEN_HARNESS_TERMINAL_PORT ?? "7681");',
  'const WORKING_DIRECTORY = process.env.OPEN_HARNESS_TERMINAL_CWD ?? "/vercel/sandbox";',
  'const TOKEN_FILE = process.env.OPEN_HARNESS_TERMINAL_TOKEN_FILE ?? "/tmp/open-harness-terminal/token";',
  'const SESSION_FILE = process.env.OPEN_HARNESS_TERMINAL_SESSION_FILE ?? "/tmp/open-harness-terminal/session-id";',
  'const DIST_DIR = path.join(process.cwd(), "node_modules", "ghostty-web", "dist");',
  'const GHOSTTY_WASM_PATH = path.join(process.cwd(), "node_modules", "ghostty-web", "ghostty-vt.wasm");',
  `const GATEWAY_VERSION = ${JSON.stringify(TERMINAL_GATEWAY_VERSION)};`,
  `const INDEX_HTML = ${JSON.stringify(TERMINAL_PAGE_HTML)};`,
  "",
  "const MIME_TYPES = new Map([",
  '  [".js", "application/javascript; charset=utf-8"],',
  '  [".css", "text/css; charset=utf-8"],',
  '  [".wasm", "application/wasm"],',
  '  [".html", "text/html; charset=utf-8"],',
  "]);",
  "const COMMON_HEADERS = {",
  '  "Access-Control-Allow-Origin": "*",',
  '  "Cross-Origin-Resource-Policy": "cross-origin",',
  "};",
  "",
  "function sendJson(res, statusCode, payload) {",
  "  res.writeHead(statusCode, {",
  "    ...COMMON_HEADERS,",
  '    "Cache-Control": "no-store",',
  '    "Content-Type": "application/json; charset=utf-8",',
  "  });",
  "  res.end(JSON.stringify(payload));",
  "}",
  "",
  "function serveFile(res, filePath) {",
  "  const extension = path.extname(filePath);",
  '  const contentType = MIME_TYPES.get(extension) ?? "application/octet-stream";',
  "  if (!existsSync(filePath)) {",
  "    res.writeHead(404, {",
  "      ...COMMON_HEADERS,",
  '      "Content-Type": "text/plain; charset=utf-8",',
  "    });",
  '    res.end("Not Found");',
  "    return;",
  "  }",
  "  res.writeHead(200, {",
  "    ...COMMON_HEADERS,",
  '    "Cache-Control": extension === ".wasm" ? "public, max-age=3600" : "no-store",',
  '    "Content-Type": contentType,',
  "  });",
  "  createReadStream(filePath).pipe(res);",
  "}",
  "",
  "function readTrimmedFile(filePath) {",
  "  try {",
  '    return readFileSync(filePath, "utf8").trim();',
  "  } catch {",
  '    return "";',
  "  }",
  "}",
  "",
  "function getLaunchToken() {",
  "  return readTrimmedFile(TOKEN_FILE);",
  "}",
  "",
  "function getGatewaySessionId() {",
  "  return readTrimmedFile(SESSION_FILE);",
  "}",
  "",
  "function isAuthorized(token, sessionId) {",
  "  const expectedToken = getLaunchToken();",
  "  const expectedSessionId = getGatewaySessionId();",
  "  return expectedToken.length > 0 && expectedSessionId.length > 0 && token === expectedToken && sessionId === expectedSessionId;",
  "}",
  "",
  "function clampSize(value, fallback, max) {",
  '  const parsed = Number.parseInt(value ?? "", 10);',
  "  if (!Number.isFinite(parsed) || parsed <= 0) {",
  "    return fallback;",
  "  }",
  "  return Math.min(parsed, max);",
  "}",
  "",
  "function getShell() {",
  '  return process.env.SHELL || "/bin/bash";',
  "}",
  "",
  "const clients = new Set();",
  "let ptyProcess = null;",
  "let ptySize = { cols: 120, rows: 32 };",
  "",
  "function ensurePty(cols, rows) {",
  "  if (ptyProcess) {",
  "    ptyProcess.resize(cols, rows);",
  "    ptySize = { cols, rows };",
  "    return ptyProcess;",
  "  }",
  "  ptyProcess = pty.spawn(getShell(), [], {",
  '    name: "xterm-256color",',
  "    cols,",
  "    rows,",
  "    cwd: WORKING_DIRECTORY,",
  "    env: {",
  "      ...process.env,",
  '      COLORTERM: "truecolor",',
  '      TERM: "xterm-256color",',
  "    },",
  "  });",
  "  ptySize = { cols, rows };",
  "  ptyProcess.onData((data) => {",
  "    for (const client of clients) {",
  "      if (client.readyState === client.OPEN) {",
  "        client.send(data);",
  "      }",
  "    }",
  "  });",
  "  ptyProcess.onExit(({ exitCode }) => {",
  "    for (const client of clients) {",
  "      if (client.readyState === client.OPEN) {",
  '        client.send("\r\n\x1B[33mShell exited (code: " + (exitCode ?? 0) + ")\x1B[0m\r\n");',
  "        client.close();",
  "      }",
  "    }",
  "    clients.clear();",
  "    ptyProcess = null;",
  "  });",
  "  return ptyProcess;",
  "}",
  "",
  "const server = createServer((req, res) => {",
  '  const host = req.headers.host ?? ("127.0.0.1:" + PORT);',
  '  const url = new URL(req.url ?? "/", "http://" + host);',
  '  if (url.pathname === "/health") {',
  "    sendJson(res, 200, {",
  "      ok: true,",
  "      version: GATEWAY_VERSION,",
  "      sessionId: getGatewaySessionId() || null,",
  "      attachedClients: clients.size,",
  "      ptyRunning: ptyProcess !== null,",
  "    });",
  "    return;",
  "  }",
  '  if (url.pathname === "/session") {',
  "    sendJson(res, 200, {",
  "      sessionId: getGatewaySessionId() || null,",
  "    });",
  "    return;",
  "  }",
  '  if (url.pathname === "/" || url.pathname === "/index.html") {',
  "    res.writeHead(200, {",
  "      ...COMMON_HEADERS,",
  '      "Cache-Control": "no-store",',
  '      "Content-Type": "text/html; charset=utf-8",',
  "    });",
  "    res.end(INDEX_HTML);",
  "    return;",
  "  }",
  '  if (url.pathname.startsWith("/dist/")) {',
  "    const distRoot = path.resolve(DIST_DIR);",
  '    const requestedDistPath = url.pathname.slice("/dist/".length);',
  "    const resolvedDistPath = path.resolve(distRoot, requestedDistPath);",
  "    if (resolvedDistPath !== distRoot && !resolvedDistPath.startsWith(distRoot + path.sep)) {",
  "      res.writeHead(403, {",
  "        ...COMMON_HEADERS,",
  '        "Content-Type": "text/plain; charset=utf-8",',
  "      });",
  '      res.end("Forbidden");',
  "      return;",
  "    }",
  "    serveFile(res, resolvedDistPath);",
  "    return;",
  "  }",
  '  if (url.pathname === "/ghostty-vt.wasm") {',
  "    serveFile(res, GHOSTTY_WASM_PATH);",
  "    return;",
  "  }",
  "  res.writeHead(404, {",
  "    ...COMMON_HEADERS,",
  '    "Content-Type": "text/plain; charset=utf-8",',
  "  });",
  '  res.end("Not Found");',
  "});",
  "",
  "const wss = new WebSocketServer({ noServer: true });",
  "",
  'server.on("upgrade", (req, socket, head) => {',
  '  const host = req.headers.host ?? ("127.0.0.1:" + PORT);',
  '  const url = new URL(req.url ?? "/", "http://" + host);',
  '  if (url.pathname !== "/ws") {',
  "    socket.destroy();",
  "    return;",
  "  }",
  '  const token = url.searchParams.get("token") ?? "";',
  '  const sessionId = url.searchParams.get("session") ?? "";',
  "  if (!isAuthorized(token, sessionId)) {",
  '    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");',
  "    socket.destroy();",
  "    return;",
  "  }",
  "  wss.handleUpgrade(req, socket, head, (ws) => {",
  '    wss.emit("connection", ws, req);',
  "  });",
  "});",
  "",
  'wss.on("connection", (ws, req) => {',
  '  const host = req.headers.host ?? ("127.0.0.1:" + PORT);',
  '  const url = new URL(req.url ?? "/", "http://" + host);',
  '  const cols = clampSize(url.searchParams.get("cols"), ptySize.cols, 300);',
  '  const rows = clampSize(url.searchParams.get("rows"), ptySize.rows, 120);',
  "  const activePty = ensurePty(cols, rows);",
  "  clients.add(ws);",
  '  ws.on("message", (rawMessage) => {',
  '    const message = rawMessage.toString("utf8");',
  "    try {",
  "      const parsed = JSON.parse(message);",
  '      if (parsed.type === "resize") {',
  '        const nextCols = clampSize(String(parsed.cols ?? ""), ptySize.cols, 300);',
  '        const nextRows = clampSize(String(parsed.rows ?? ""), ptySize.rows, 120);',
  "        activePty.resize(nextCols, nextRows);",
  "        ptySize = { cols: nextCols, rows: nextRows };",
  "        return;",
  "      }",
  '      if (parsed.type === "input" && typeof parsed.data === "string") {',
  "        activePty.write(parsed.data);",
  "        return;",
  "      }",
  "    } catch {}",
  "    activePty.write(message);",
  "  });",
  '  ws.on("close", () => {',
  "    clients.delete(ws);",
  "  });",
  '  ws.on("error", () => {});',
  "});",
  "",
  "function shutdown() {",
  "  for (const client of clients) {",
  "    try {",
  "      client.close();",
  "    } catch {}",
  "  }",
  "  clients.clear();",
  "  if (ptyProcess) {",
  "    try {",
  "      ptyProcess.kill();",
  "    } catch {}",
  "    ptyProcess = null;",
  "  }",
  "  wss.close();",
  "  server.close(() => process.exit(0));",
  "}",
  "",
  'process.on("SIGINT", shutdown);',
  'process.on("SIGTERM", shutdown);',
  "",
  'server.listen(PORT, "0.0.0.0", () => {',
  '  console.log("[OpenHarnessTerminalGateway] listening on " + PORT);',
  "});",
];

export const TERMINAL_GATEWAY_SCRIPT = TERMINAL_GATEWAY_SCRIPT_LINES.join("\n");
