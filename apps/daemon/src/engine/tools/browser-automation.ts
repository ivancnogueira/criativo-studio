import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CriativoDatabase } from "../../database/client.ts";

export interface BrowserProfile {
  perfil_id: string;
  nome: string;
  user_data_dir: string;
  proxy_url: string | null;
  ultimo_uso_em: string | null;
}

export interface BrowserNavigationParams {
  url: string;
  perfil_id?: string;
  extract_mode?: "text" | "links" | "screenshot_plan";
}

export interface BrowserNavigationResult {
  url: string;
  status: number;
  title: string;
  textPreview: string;
  perfil_id: string;
}

/**
 * Gerenciador de perfis persistentes e automação headless Chromium (`projecao_perfis_navegador`)
 * usado pelo agente 11 (Inteligência Competitiva) para pesquisa web segura.
 */
export class BrowserAutomationService {
  private readonly db: CriativoDatabase;

  constructor(db: CriativoDatabase) {
    this.db = db;
  }

  public ensureProfile(nome: string, proxyUrl?: string): BrowserProfile {
    const existing = this.db.connection
      .prepare(`SELECT * FROM projecao_perfis_navegador WHERE nome = ?;`)
      .get(nome) as unknown as BrowserProfile | undefined;

    if (existing) {
      return existing;
    }

    const perfilId = randomUUID();
    const userDataDir = resolve(process.cwd(), "dados", "browser-profiles", perfilId);
    mkdirSync(userDataDir, { recursive: true });

    this.db.runInTransaction(() => {
      this.db.connection
        .prepare(
          `
          INSERT INTO projecao_perfis_navegador (perfil_id, nome, user_data_dir, proxy_url, ultimo_uso_em)
          VALUES (?, ?, ?, ?, ?);
        `
        )
        .run(perfilId, nome, userDataDir, proxyUrl ?? null, new Date().toISOString());
    });

    return this.db.connection
      .prepare(`SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ?;`)
      .get(perfilId) as unknown as BrowserProfile;
  }

  public async inspectPublicPage(
    params: BrowserNavigationParams
  ): Promise<BrowserNavigationResult> {
    const parsedUrl = new URL(params.url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error(`Protocolo não permitido na automação de navegador: ${parsedUrl.protocol}`);
    }

    const profile = params.perfil_id
      ? ((this.db.connection
          .prepare(`SELECT * FROM projecao_perfis_navegador WHERE perfil_id = ?;`)
          .get(params.perfil_id) as unknown as BrowserProfile | undefined) ??
        this.ensureProfile("perfil-pesquisa-padrao"))
      : this.ensureProfile("perfil-pesquisa-padrao");

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "CriativoAIStudio-ResearchBot/1.0",
        Accept: "text/html,application/xhtml+xml,application/json",
      },
    });
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : parsedUrl.hostname;
    const textPreview = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1500);

    this.db.connection
      .prepare(`UPDATE projecao_perfis_navegador SET ultimo_uso_em = ? WHERE perfil_id = ?;`)
      .run(new Date().toISOString(), profile.perfil_id);

    return {
      url: parsedUrl.toString(),
      status: response.status,
      title,
      textPreview,
      perfil_id: profile.perfil_id,
    };
  }
}
