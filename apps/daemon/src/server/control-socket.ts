import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadavg } from "node:os";
import { dirname } from "node:path";
import type { CriativoDatabase } from "../database/client.ts";
import type { FifoQueueManager } from "../queue/fifo-queue.ts";

export interface ControlSocketOptions {
  socketPath: string;
  db: CriativoDatabase;
  queue: FifoQueueManager;
  getWhatsAppStatus: () => unknown;
  onRestartRequested?: () => void;
}

/**
 * Servidor de controle local via Unix Socket (`control.sock` com permissão 0700)
 * ou Named Pipe no Windows, permitindo gerenciamento seguro via CLI sem portas públicas.
 */
export class ControlSocketServer {
  public readonly socketPath: string;
  private readonly server: Server;
  private readonly startedAt = Date.now();
  private readonly options: ControlSocketOptions;

  constructor(options: ControlSocketOptions) {
    this.options = options;
    this.socketPath = options.socketPath;
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";

    if (method === "GET" && url.pathname === "/status") {
      const activeAgents = (
        this.options.db.connection
          .prepare(`SELECT COUNT(*) as total FROM projecao_agentes WHERE status = 'trabalhando';`)
          .get() as { total: number }
      ).total;
      const pendingTasks = this.options.queue.listTasks("pendente").length;
      const runningTasks = this.options.queue.listTasks("executando").length;
      const mem = process.memoryUsage();

      this.sendJson(res, 200, {
        status: "ok",
        version: "1.0.0",
        uptime_sec: Math.round((Date.now() - this.startedAt) / 1000),
        cpu_load_1m: Number(loadavg()[0].toFixed(2)),
        memoria_rss_mb: Math.round(mem.rss / 1024 / 1024),
        agentes_ativos: activeAgents,
        tarefas_pendentes: pendingTasks,
        tarefas_executando: runningTasks,
        whatsapp: this.options.getWhatsAppStatus(),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/queue") {
      const tarefas = this.options.queue.listTasks(undefined, 50);
      this.sendJson(res, 200, {
        total: tarefas.length,
        tarefas: tarefas.map((t) => ({
          tarefa_id: t.tarefa_id,
          titulo: t.titulo,
          tipo: t.tipo,
          status: t.status,
          prioridade: t.prioridade,
          canal_origem: t.canal_origem,
          agente_id: t.agente_id,
        })),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/whatsapp-status") {
      this.sendJson(res, 200, this.options.getWhatsAppStatus());
      return;
    }

    if (method === "POST" && url.pathname === "/restart") {
      this.sendJson(res, 200, { ok: true, mensagem: "Reinicialização solicitada." });
      setTimeout(() => {
        this.options.onRestartRequested?.();
      }, 50);
      return;
    }

    this.sendJson(res, 404, { erro: `Comando de controle desconhecido: ${url.pathname}` });
  }

  public async listen(): Promise<void> {
    const isNamedPipe = this.socketPath.startsWith("\\\\.\\pipe\\");
    if (!isNamedPipe) {
      mkdirSync(dirname(this.socketPath), { recursive: true });
      if (existsSync(this.socketPath)) {
        rmSync(this.socketPath, { force: true });
      }
    }

    await new Promise<void>((resolveListen, rejectListen) => {
      this.server.once("error", rejectListen);
      this.server.listen(this.socketPath, () => {
        this.server.off("error", rejectListen);
        if (!isNamedPipe && process.platform !== "win32") {
          try {
            chmodSync(this.socketPath, 0o700);
          } catch {
            // ignora se o filesystem não suportar chmod
          }
        }
        resolveListen();
      });
    });
  }

  public async close(): Promise<void> {
    await new Promise<void>((resolveClose) => {
      this.server.close(() => resolveClose());
    });
    const isNamedPipe = this.socketPath.startsWith("\\\\.\\pipe\\");
    if (!isNamedPipe && existsSync(this.socketPath)) {
      rmSync(this.socketPath, { force: true });
    }
  }
}
