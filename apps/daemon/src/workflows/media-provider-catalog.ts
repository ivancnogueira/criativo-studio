import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MediaProviderDescriptor } from "@criativo/contracts";
import type { FetchLike } from "../engine/providers/provider-interface.ts";
import {
  generateImageTool,
  type GenerateImageParams,
  type GenerateImageResult,
} from "../engine/tools/generate-image.ts";
import {
  generateVideoTool,
  type GenerateVideoParams,
  type GenerateVideoResult,
} from "../engine/tools/generate-video.ts";
import { executeRemotionRender } from "../engine/tools/remotion-bridge.ts";
import type { VaultService } from "../vault/vault-service.ts";

export interface HttpMediaProviderSpec {
  id: string;
  label: string;
  kind: "image" | "video";
  endpointUrl: string;
  models: string[];
  vaultSecretKey?: string;
}

export interface McpMediaGatewayLike {
  listAvailableTools?: () => Array<{
    mcpId: string;
    serverName?: string;
    name: string;
    description?: string;
  }>;
  callTool?: (mcpId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Catálogo plugável de provedores de mídia para Workflows (`gerar_imagem` e `render_video`):
 * unifica engines nativos, adaptadores HTTP externos (Cofre) e ferramentas MCP de mídia.
 */
export class MediaProviderCatalog {
  private readonly vault?: VaultService;
  private readonly fetchImpl?: FetchLike;
  private readonly mcpGateway?: McpMediaGatewayLike;
  private readonly httpProviders = new Map<string, HttpMediaProviderSpec>();

  constructor(
    deps: {
      vault?: VaultService;
      fetchImpl?: FetchLike;
      mcpGateway?: McpMediaGatewayLike;
    } = {}
  ) {
    this.vault = deps.vault;
    this.fetchImpl = deps.fetchImpl;
    this.mcpGateway = deps.mcpGateway;
  }

  public registerHttpProvider(spec: HttpMediaProviderSpec): void {
    this.httpProviders.set(spec.id, spec);
  }

  public listProviders(): MediaProviderDescriptor[] {
    const items: MediaProviderDescriptor[] = [
      {
        id: "native:gemini",
        label: "Gemini Imagen / Nano (Nativo)",
        kind: "image",
        source: "native",
        models: ["gemini-nano-banana-2.1", "gemini-3.1-flash-image", "gemini-2.5-flash-image"],
        requiresVaultKey: "gemini_api_key",
      },
      {
        id: "native:openai",
        label: "OpenAI GPT Image (Nativo)",
        kind: "image",
        source: "native",
        models: ["gpt-image-2.6-sunburst", "gpt-image-1"],
        requiresVaultKey: "openai_api_key",
      },
      {
        id: "native:flux",
        label: "Flux / Fal.ai (Nativo)",
        kind: "image",
        source: "native",
        models: ["flux-1.1-pro"],
        requiresVaultKey: "fal_api_key",
      },
      {
        id: "native:remotion",
        label: "Remotion Cinematográfico (Nativo)",
        kind: "video",
        source: "native",
        models: ["ReelsFaceless", "ReelsTalkingHead"],
      },
      {
        id: "native:gemini-video",
        label: "Gemini Video Interactions (Nativo)",
        kind: "video",
        source: "native",
        models: ["gemini-omni-1.2-flash"],
        requiresVaultKey: "gemini_api_key",
      },
    ];

    for (const httpSpec of this.httpProviders.values()) {
      items.push({
        id: httpSpec.id,
        label: httpSpec.label,
        kind: httpSpec.kind,
        source: "http_custom",
        models: httpSpec.models,
        requiresVaultKey: httpSpec.vaultSecretKey,
      });
    }

    const mcpTools = this.mcpGateway?.listAvailableTools?.() ?? [];
    for (const tool of mcpTools) {
      const lower = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
      const isVideo =
        lower.includes("video") || lower.includes("reels") || lower.includes("render");
      const isImage =
        lower.includes("image") ||
        lower.includes("imagem") ||
        lower.includes("flux") ||
        lower.includes("midjourney") ||
        lower.includes("draw");
      if (!isVideo && !isImage) continue;
      items.push({
        id: `mcp:${tool.mcpId}:${tool.name}`,
        label: `MCP · ${tool.serverName ?? tool.mcpId} (${tool.name})`,
        kind: isVideo && !isImage ? "video" : "image",
        source: "mcp",
        models: [tool.name],
        mcpServerId: tool.mcpId,
        mcpToolName: tool.name,
      });
    }

    return items;
  }

  public async executeImageStep(params: {
    providerId?: string;
    modelId?: string;
    generateParams: GenerateImageParams;
    fallbackFn?: () => Promise<GenerateImageResult>;
  }): Promise<{ outputPath: string; providerUsed: string; modelUsed: string }> {
    const providerId = params.providerId?.trim() || "";

    if (providerId.startsWith("http:") || this.httpProviders.has(providerId)) {
      const spec = this.httpProviders.get(providerId);
      if (!spec || spec.kind !== "image") {
        throw new Error(`Provedor de imagem HTTP '${providerId}' não encontrado.`);
      }
      const outPath = await this.invokeHttpImageProvider(spec, params.generateParams, params.modelId);
      return {
        outputPath: outPath,
        providerUsed: spec.id,
        modelUsed: params.modelId || spec.models[0] || "custom-image",
      };
    }

    if (providerId.startsWith("mcp:")) {
      const [, mcpId, ...toolParts] = providerId.split(":");
      const toolName = toolParts.join(":");
      if (!this.mcpGateway?.callTool || !mcpId || !toolName) {
        throw new Error(`Gateway MCP indisponível para provedor '${providerId}'.`);
      }
      const res = (await this.mcpGateway.callTool(mcpId, toolName, {
        prompt: params.generateParams.prompt,
        aspect_ratio: params.generateParams.aspect_ratio,
        output_path: params.generateParams.output_path,
        model: params.modelId,
      })) as { output_path?: string; base64?: string } | null;

      if (res?.base64) {
        mkdirSync(dirname(params.generateParams.output_path), { recursive: true });
        writeFileSync(params.generateParams.output_path, Buffer.from(res.base64, "base64"));
      }
      const resolvedOut = res?.output_path || params.generateParams.output_path;
      return {
        outputPath: resolvedOut,
        providerUsed: providerId,
        modelUsed: params.modelId || toolName,
      };
    }

    if (!providerId && params.fallbackFn) {
      const res = await params.fallbackFn();
      return {
        outputPath: res.output_path,
        providerUsed: `native:${res.engine_used}`,
        modelUsed: res.model_used,
      };
    }

    const engine =
      providerId === "native:openai"
        ? "openai"
        : providerId === "native:flux"
          ? "flux"
          : providerId === "native:gemini"
            ? "gemini"
            : params.generateParams.engine;

    if (!this.vault) {
      throw new Error("VaultService obrigatório para provedor nativo de imagem.");
    }

    const res = await generateImageTool(
      {
        ...params.generateParams,
        engine,
        model: params.modelId || params.generateParams.model,
      },
      { vault: this.vault, fetchImpl: this.fetchImpl }
    );
    return {
      outputPath: res.output_path,
      providerUsed: `native:${res.engine_used}`,
      modelUsed: res.model_used,
    };
  }

  public async executeVideoStep(params: {
    providerId?: string;
    modelId?: string;
    videoParams?: GenerateVideoParams;
    remotionArgs?: {
      composicao: "ReelsFaceless" | "ReelsTalkingHead";
      audio_path: string;
      output_path: string;
      remotionProjectDir: string;
      props?: Record<string, unknown>;
    };
  }): Promise<{ outputPath: string; providerUsed: string; modelUsed: string }> {
    const providerId = params.providerId?.trim() || "native:remotion";

    if (providerId.startsWith("http:") || this.httpProviders.has(providerId)) {
      const spec = this.httpProviders.get(providerId);
      if (!spec || spec.kind !== "video") {
        throw new Error(`Provedor de vídeo HTTP '${providerId}' não encontrado.`);
      }
      const targetOut =
        params.videoParams?.output_path ?? params.remotionArgs?.output_path ?? "";
      const outPath = await this.invokeHttpVideoProvider(spec, {
        prompt: params.videoParams?.prompt ?? String(params.remotionArgs?.props?.roteiroTexto ?? ""),
        outputPath: targetOut,
        modelId: params.modelId,
      });
      return {
        outputPath: outPath,
        providerUsed: spec.id,
        modelUsed: params.modelId || spec.models[0] || "custom-video",
      };
    }

    if (providerId === "native:gemini-video" && params.videoParams && this.vault) {
      const res: GenerateVideoResult = await generateVideoTool(
        {
          ...params.videoParams,
          model: params.modelId || params.videoParams.model,
        },
        { vault: this.vault, fetchImpl: this.fetchImpl }
      );
      return {
        outputPath: res.output_path,
        providerUsed: "native:gemini-video",
        modelUsed: res.model_used,
      };
    }

    if (params.remotionArgs) {
      const composicao =
        params.modelId === "ReelsTalkingHead" ? "ReelsTalkingHead" : params.remotionArgs.composicao;
      await executeRemotionRender({
        ...params.remotionArgs,
        composicao,
      });
      return {
        outputPath: params.remotionArgs.output_path,
        providerUsed: "native:remotion",
        modelUsed: composicao,
      };
    }

    throw new Error(`Configuração insuficiente para render_video com provedor '${providerId}'.`);
  }

  private async invokeHttpImageProvider(
    spec: HttpMediaProviderSpec,
    genParams: GenerateImageParams,
    modelId?: string
  ): Promise<string> {
    const fetchFn = this.fetchImpl ?? (fetch as unknown as FetchLike);
    const token = spec.vaultSecretKey ? this.vault?.getSecret(spec.vaultSecretKey) : null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetchFn(spec.endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: genParams.prompt,
        aspect_ratio: genParams.aspect_ratio,
        model: modelId || spec.models[0],
      }),
    });
    if (!res.ok) {
      throw new Error(`Provedor de imagem '${spec.label}' retornou HTTP ${res.status}.`);
    }
    const data = (await res.json()) as { b64_json?: string; image_base64?: string; url?: string };
    const b64 = data.b64_json ?? data.image_base64;
    if (b64) {
      mkdirSync(dirname(genParams.output_path), { recursive: true });
      writeFileSync(genParams.output_path, Buffer.from(b64, "base64"));
      return genParams.output_path;
    }
    if (data.url) {
      const imgRes = await fetchFn(data.url, { method: "GET" });
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        mkdirSync(dirname(genParams.output_path), { recursive: true });
        writeFileSync(genParams.output_path, buf);
        return genParams.output_path;
      }
    }
    throw new Error(`Resposta sem imagem válida do provedor '${spec.label}'.`);
  }

  private async invokeHttpVideoProvider(
    spec: HttpMediaProviderSpec,
    opts: { prompt: string; outputPath: string; modelId?: string }
  ): Promise<string> {
    const fetchFn = this.fetchImpl ?? (fetch as unknown as FetchLike);
    const token = spec.vaultSecretKey ? this.vault?.getSecret(spec.vaultSecretKey) : null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetchFn(spec.endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: opts.prompt,
        model: opts.modelId || spec.models[0],
      }),
    });
    if (!res.ok) {
      throw new Error(`Provedor de vídeo '${spec.label}' retornou HTTP ${res.status}.`);
    }
    const data = (await res.json()) as { video_base64?: string; url?: string };
    if (data.video_base64 && opts.outputPath) {
      mkdirSync(dirname(opts.outputPath), { recursive: true });
      writeFileSync(opts.outputPath, Buffer.from(data.video_base64, "base64"));
      return opts.outputPath;
    }
    if (data.url && opts.outputPath) {
      const vidRes = await fetchFn(data.url, { method: "GET" });
      if (vidRes.ok) {
        mkdirSync(dirname(opts.outputPath), { recursive: true });
        writeFileSync(opts.outputPath, Buffer.from(await vidRes.arrayBuffer()));
        return opts.outputPath;
      }
    }
    if (opts.outputPath && existsSync(opts.outputPath)) {
      return opts.outputPath;
    }
    throw new Error(`Resposta sem vídeo válido do provedor '${spec.label}'.`);
  }
}
