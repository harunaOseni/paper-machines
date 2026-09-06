import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number.parseInt(process.env.PORT || "4173", 10);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root)) {
    json(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const details = await stat(filePath);
    if (!details.isFile()) throw new Error("Not a file");
    const contents = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-cache"
    });
    response.end(contents);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, {
        ok: true,
        app: "Paper Machines"
      });
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : "Unexpected server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Paper Machines is running at http://localhost:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
