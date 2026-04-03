import { createServer, type Server } from "node:http";

import type { NodeContext } from "./nodeContext";

const MONITOR_HOST = "127.0.0.1";
const MONITOR_PORT = 9080;

export type MonitorRuntimeState = {
  booting: boolean;
  listenersStarted: boolean;
  shutdownRequested: boolean;
  autoRegister: boolean;
  autoUnregister: boolean;
  registration: {
    attempted: boolean;
    succeeded: boolean;
    txDigest: string | null;
    lastError: string | null;
  };
};

export function startMonitorServer(ctx: NodeContext, state: MonitorRuntimeState): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${MONITOR_HOST}:${MONITOR_PORT}`}`);

    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (url.pathname !== "/health" && url.pathname !== "/status") {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const uptimeMs = Date.now() - ctx.startupMs;
    const body = {
      status: state.booting ? "booting" : "ok",
      nodeId: ctx.nodeId,
      address: ctx.identity.address,
      acceptedTemplateIds: ctx.acceptedTemplateIds,
      pollMs: ctx.pollMs,
      startupMs: ctx.startupMs,
      uptimeMs,
      runtime: state,
      monitor: {
        host: MONITOR_HOST,
        port: MONITOR_PORT,
        path: url.pathname,
      },
    };

    const code = state.booting ? 503 : 200;
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body, null, 2));
  });

  server.listen(MONITOR_PORT, MONITOR_HOST, () => {
    console.log(`[node ${ctx.nodeId}] monitor listening on http://${MONITOR_HOST}:${MONITOR_PORT}`);
  });

  return server;
}
