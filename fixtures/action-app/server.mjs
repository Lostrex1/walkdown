import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4173);
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Walkdown Action fixture</title></head>
  <body><main><h1>Ready</h1><a href="/details">Details</a></main></body>
</html>`);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`fixture listening on ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
