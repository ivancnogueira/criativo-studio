import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { MediaProviderCatalog } from "../src/workflows/media-provider-catalog.ts";

test("MediaProviderCatalog: lista provedores nativos, HTTP externos e MCPs de mídia e executa roteamento uniforme", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "criativo-media-cat-"));
  try {
    const db = new CriativoDatabase({ dbPath: ":memory:" });
    db.initializeDatabase();
    const vault = new VaultService(db, "chave-teste-fase33-midia");
    vault.setSecret("external_flux_key", "fake-ext-media-token");

    let receivedAuth = "";
    let mcpCalledWith: { mcpId: string; toolName: string; args: Record<string, unknown> } | null = null;

    const fakeFetch = async (_url: string, init?: { headers?: Record<string, string> }) => {
      receivedAuth = init?.headers?.Authorization ?? "";
      return new Response(
        JSON.stringify({
          b64_json: Buffer.from("fake-png-bytes", "utf8").toString("base64"),
        }),
        { status: 200 }
      );
    };

    const catalog = new MediaProviderCatalog({
      vault,
      fetchImpl: fakeFetch as never,
      mcpGateway: {
        listAvailableTools: () => [
          {
            mcpId: "mcp-design",
            serverName: "Design MCP",
            name: "generate_brand_image",
            description: "Gera imagem criativa via servidor MCP",
          },
          {
            mcpId: "mcp-notes",
            serverName: "Notes",
            name: "read_notes",
            description: "Lê anotações de texto",
          },
        ],
        callTool: async (mcpId, toolName, args) => {
          mcpCalledWith = { mcpId, toolName, args };
          return {
            base64: Buffer.from("mcp-png-bytes", "utf8").toString("base64"),
          };
        },
      },
    });

    catalog.registerHttpProvider({
      id: "http:external-flux",
      label: "External Flux HTTP",
      kind: "image",
      endpointUrl: "https://media.example/v1/images",
      models: ["flux-pro-1.1"],
      vaultSecretKey: "external_flux_key",
    });

    const list = catalog.listProviders();
    assert.ok(list.some((p) => p.id === "native:gemini" && p.kind === "image"));
    assert.ok(list.some((p) => p.id === "native:remotion" && p.kind === "video"));
    assert.ok(list.some((p) => p.id === "http:external-flux" && p.source === "http_custom"));
    assert.ok(list.some((p) => p.id === "mcp:mcp-design:generate_brand_image" && p.source === "mcp"));
    assert.equal(list.some((p) => p.mcpToolName === "read_notes"), false);

    // 1. Execução via provedor HTTP customizado
    const httpOut = join(tempDir, "http-out.png");
    const resHttp = await catalog.executeImageStep({
      providerId: "http:external-flux",
      modelId: "flux-pro-1.1",
      generateParams: {
        aspect_ratio: "3:4",
        prompt: "Cena editorial minimalista",
        output_path: httpOut,
      },
    });
    assert.equal(resHttp.providerUsed, "http:external-flux");
    assert.equal(receivedAuth, "Bearer fake-ext-media-token");
    assert.equal(existsSync(httpOut), true);
    assert.equal(readFileSync(httpOut, "utf8"), "fake-png-bytes");

    // 2. Execução via ferramenta MCP de mídia
    const mcpOut = join(tempDir, "mcp-out.png");
    const resMcp = await catalog.executeImageStep({
      providerId: "mcp:mcp-design:generate_brand_image",
      generateParams: {
        aspect_ratio: "1:1",
        prompt: "Capa podcast [NOME_DA_MARCA]",
        output_path: mcpOut,
      },
    });
    assert.equal(resMcp.providerUsed, "mcp:mcp-design:generate_brand_image");
    assert.equal(mcpCalledWith?.mcpId, "mcp-design");
    assert.equal(mcpCalledWith?.toolName, "generate_brand_image");
    assert.equal(existsSync(mcpOut), true);
    assert.equal(readFileSync(mcpOut, "utf8"), "mcp-png-bytes");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
