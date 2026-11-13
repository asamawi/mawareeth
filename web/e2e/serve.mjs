// Serves the static export (web/out) for the browser tests. Only node: built-ins.
// It mirrors the two behaviours the export relies on: `dir/` serves `dir/index.html`, and a
// missing file is a real 404 (no SPA fallback). It does not reimplement Django's CSP.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
const port = Number(process.env.E2E_PORT ?? 4173);

if (!existsSync(join(root, "en", "index.html"))) {
  console.error(`No export at ${root}. Run \`npm run build\` before \`npm run test:e2e\`.`);
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function reply(response, status, body = "", headers = {}) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  response.end(body);
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") return reply(response, 405, "Method not allowed");
    const url = new URL(request.url ?? "/", "http://localhost");
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return reply(response, 400, "Bad request");
    }
    if (pathname.includes("\0") || pathname.split(/[\/]/).includes("..")) return reply(response, 400, "Bad request");

    let file = resolve(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) return reply(response, 400, "Bad request");

    if (await isDirectory(file)) {
      if (!pathname.endsWith("/")) {
        return reply(response, 308, "", { Location: `${url.pathname}/${url.search}` });
      }
      file = join(file, "index.html");
    }

    let data;
    try {
      data = await readFile(file);
    } catch {
      return reply(response, 404, "Not found");
    }
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Content-Length": data.length });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    reply(response, 500, "Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} on http://127.0.0.1:${port}`);
});
