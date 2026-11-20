import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

const webRoot = resolve(fileURLToPath(import.meta.url), "../..");

describe("Avatares V2 — 8 Estilos, 20 Modelos por Estilo, Z-Order de Óculos, Foto/IA e Emoções por Tarefa (SSR)", () => {
  let vite;

  before(async () => {
    vite = await createViteServer({
      root: webRoot,
      server: { middlewareMode: true },
      appType: "custom",
    });
  });

  after(async () => {
    await vite.close();
  });

  it("1. Expõe exatamente os 8 estilos aprovados (sem Pixel Art e sem Orbe) e 20 modelos por estilo novo", async () => {
    const mod = await vite.ssrLoadModule("/src/components/MascoteAvatar.tsx");
    const ids = mod.AVATAR_STYLES.map((s) => s.id);
    assert.deepEqual(ids, [
      "classic",
      "plush",
      "cartoon",
      "robots",
      "personas",
      "pets",
      "monsters",
      "image",
    ]);
    assert.equal(ids.includes("pixel"), false);
    assert.equal(ids.includes("orb"), false);

    assert.equal(mod.AVATAR_VARIANTS_BY_STYLE.classic.length, 8);
    for (const st of ["plush", "cartoon", "robots", "personas", "pets", "monsters"]) {
      const variants = mod.AVATAR_VARIANTS_BY_STYLE[st];
      assert.equal(variants.length, 20, `Estilo ${st} deve possuir 20 variações`);
      const uniqueIds = new Set(variants.map((v) => v.id));
      assert.equal(uniqueIds.size, 20, `IDs duplicados encontrados no estilo ${st}`);
    }
  });

  it("2. Renderiza todos os 8 estilos em SSR, garante óculos na frente dos olhos e suporta Foto/IA + fallback", async () => {
    const { MascoteAvatar, AVATAR_VARIANTS_BY_STYLE } = await vite.ssrLoadModule(
      "/src/components/MascoteAvatar.tsx"
    );

    const classicHtml = renderToStaticMarkup(
      React.createElement(MascoteAvatar, {
        style: "classic",
        shape: "hex",
        color: "#38bdf8",
        size: 40,
      })
    );
    assert.match(classicHtml, /data-avatar-style="classic"/);

    // Verifica todas as variantes de Plush+, Cartoon, Robots, Personas, Pets e Monsters + z-order de óculos
    for (const style of ["plush", "cartoon", "robots", "personas", "pets", "monsters"]) {
      for (const variant of AVATAR_VARIANTS_BY_STYLE[style]) {
        const html = renderToStaticMarkup(
          React.createElement(MascoteAvatar, {
            style,
            variant: variant.id,
            color: "#f97316",
            size: 48,
            expressionOverride: variant.id === "plush_classic" ? "talking" : undefined,
          })
        );
        assert.match(html, new RegExp(`data-avatar-style="${style}"`));
        assert.match(html, new RegExp(`data-avatar-variant="${variant.id}"`));

        if (html.includes('data-layer="avatar-glasses"')) {
          const faceIdx = html.indexOf('data-layer="avatar-face-rig"');
          const glassIdx = html.indexOf('data-layer="avatar-glasses"');
          assert.ok(
            faceIdx >= 0 && glassIdx > faceIdx,
            `Óculos devem ser renderizados APÓS os olhos em ${style}:${variant.id}`
          );
        }
      }
    }

    // Verifica estilo "cool" colocando óculos após face rig
    const coolHtml = renderToStaticMarkup(
      React.createElement(MascoteAvatar, {
        style: "plush",
        variant: "plush_classic",
        color: "#38bdf8",
        size: 48,
        expressionOverride: "cool",
      })
    );
    assert.ok(
      coolHtml.indexOf('data-layer="avatar-glasses"') >
        coolHtml.indexOf('data-layer="avatar-face-rig"'),
      "Expressão cool deve renderizar óculos depois dos olhos"
    );

    // Estilo Foto / IA com URL válida e fallback quando sem URL
    const imageHtml = renderToStaticMarkup(
      React.createElement(MascoteAvatar, {
        style: "image",
        color: "#38bdf8",
        imageUrl: "/api/arquivos/raw?path=recursos%2Favatares%2Fdemo.png",
        size: 44,
        mood: "working",
        activity: "ads",
      })
    );
    assert.match(imageHtml, /<img[^>]+src="\/api\/arquivos\/raw\?path=recursos%2Favatares%2Fdemo\.png"/);

    const fallbackHtml = renderToStaticMarkup(
      React.createElement(MascoteAvatar, {
        style: "image",
        color: "#38bdf8",
        imageUrl: null,
        size: 44,
      })
    );
    assert.match(fallbackHtml, /<svg/);
  });

  it("3. Classifica contexto real da tarefa corretamente para playlists de emoções", async () => {
    const { inferTaskContextFromActivity, resolveAgentAvatarConfig } = await vite.ssrLoadModule(
      "/src/components/MascoteAvatar.tsx"
    );

    assert.equal(inferTaskContextFromActivity({ mood: "failed" }), "error");
    assert.equal(
      inferTaskContextFromActivity({ statusText: "Erro Timeout ao consultar provedor" }),
      "error"
    );
    assert.equal(inferTaskContextFromActivity({ awaitingApproval: true }), "approval");
    assert.equal(
      inferTaskContextFromActivity({
        mood: "working",
        toolName: "meta_ads",
        statusText: "Analisando métricas e ROI da campanha",
      }),
      "ads"
    );
    assert.equal(
      inferTaskContextFromActivity({
        mood: "working",
        toolName: "generate_image",
        statusText: "Gerando carrossel 3:4",
      }),
      "media"
    );
    assert.equal(
      inferTaskContextFromActivity({
        mood: "working",
        toolName: "browser_navigate",
        statusText: "Pesquisando perfil concorrente",
      }),
      "research"
    );
    assert.equal(inferTaskContextFromActivity({ mood: "working", isStreaming: true }), "talking");
    assert.equal(inferTaskContextFromActivity({ mood: "completed" }), "completed");
    assert.equal(inferTaskContextFromActivity({ agentStatus: "pausado" }), "sleeping");
    assert.equal(inferTaskContextFromActivity({ mood: "idle" }), "idle");

    const resolved = resolveAgentAvatarConfig({
      agente_id: "designer",
      config: {
        avatar_style: "robots",
        avatar_variant: "bot_cat",
        avatar_color: "#a855f7",
      },
    });
    assert.equal(resolved.style, "robots");
    assert.equal(resolved.variant, "bot_cat");
    assert.equal(resolved.color, "#a855f7");
  });

  it("4. MascoteAppearancePicker exibe as 8 abas, 20 modelos e painel Foto / IA", async () => {
    const { MascoteAppearancePicker } = await vite.ssrLoadModule(
      "/src/components/MascoteAvatar.tsx"
    );

    const plushPickerHtml = renderToStaticMarkup(
      React.createElement(MascoteAppearancePicker, {
        color: "#38bdf8",
        shape: "blob",
        style: "plush",
        variant: "plush_shades",
        onChangeColor: () => {},
        onChangeShape: () => {},
        onChangeStyle: () => {},
        onChangeVariant: () => {},
      })
    );
    assert.match(plushPickerHtml, /Clássico/);
    assert.match(plushPickerHtml, /Plush\+/);
    assert.match(plushPickerHtml, /Carinhas Cartoon/);
    assert.match(plushPickerHtml, /Robozinhos/);
    assert.match(plushPickerHtml, /Personagens/);
    assert.match(plushPickerHtml, /Bichinhos/);
    assert.match(plushPickerHtml, /Monstrinhos/);
    assert.match(plushPickerHtml, /Foto \/ IA/);
    assert.match(plushPickerHtml, /20 variações/);

    const imagePickerHtml = renderToStaticMarkup(
      React.createElement(MascoteAppearancePicker, {
        color: "#38bdf8",
        shape: "blob",
        style: "image",
        imageUrl: null,
        onChangeColor: () => {},
        onChangeShape: () => {},
        onChangeStyle: () => {},
        onChangeImageUrl: () => {},
      })
    );
    assert.match(imagePickerHtml, /Enviar foto do computador/);
    assert.match(imagePickerHtml, /Gerar com IA/);
  });

  it("5. Animação automática ocorre apenas durante trabalho ou hover (sem loop em repouso)", async () => {
    const baseSrc = readFileSync(
      join(webRoot, "src", "components", "avatars", "MascoteAvatarBase.tsx"),
      "utf8"
    );
    assert.match(baseSrc, /isWorking && size >= 24 && !expressionOverride/);
    assert.match(baseSrc, /EXPRESSIVE_HOVER_FACES/);

    const { MascoteAvatar } = await vite.ssrLoadModule("/src/components/MascoteAvatar.tsx");
    const idleHtml = renderToStaticMarkup(
      React.createElement(MascoteAvatar, {
        style: "cartoon",
        variant: "cart_squircle",
        color: "#38bdf8",
        size: 40,
        mood: "idle",
      })
    );
    assert.doesNotMatch(idleHtml, /mascote-working/);
    assert.doesNotMatch(idleHtml, /mascote-idle/);

    const workingHtml = renderToStaticMarkup(
      React.createElement(MascoteAvatar, {
        style: "cartoon",
        variant: "cart_squircle",
        color: "#38bdf8",
        size: 40,
        mood: "working",
        activity: "ads",
      })
    );
    assert.match(workingHtml, /mascote-working/);
  });
});
