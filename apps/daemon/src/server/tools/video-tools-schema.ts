import type { ToolDefinition } from "@criativo/contracts";

export const VIDEO_STUDIO_TOOLS_SCHEMA: ToolDefinition[] = [
  {
    name: "exec_remotion_render",
    description:
      "Renderiza um vídeo MP4 1080x1920 a 30fps usando o projeto Remotion gerenciado do CriativoOS (composições ReelsFaceless/FacelessReels ou ReelsTalkingHead/TalkingHeadReels), salvando em saidas/videos/.",
    parameters: {
      type: "object",
      properties: {
        composicao: {
          type: "string",
          enum: ["ReelsFaceless", "ReelsTalkingHead", "FacelessReels", "TalkingHeadReels"],
          description: "Composição Remotion alvo.",
        },
        audio_path: {
          type: "string",
          description: "Caminho do áudio/locução principal ou vídeo base.",
        },
        legendas_srt_path: {
          type: "string",
          description: "Caminho opcional do arquivo de legendas .srt.",
        },
        output_path: {
          type: "string",
          description: "Caminho de saída do MP4 (padrão em saidas/videos/).",
        },
        props: {
          type: "object",
          description: "Propriedades JSON da composição (scenes, infographics, subtitlesWords, brandHighlightColor, zoomMoments, brolls, backgroundMusicUrl).",
        },
      },
      required: ["composicao", "audio_path"],
    },
  },
  {
    name: "video_inspect_and_silences",
    description:
      "Inspeciona um arquivo de vídeo/áudio com ffprobe (duração, resolução, fps, streams) e detecta intervalos de silêncio/pausas com ffmpeg silencedetect. Aceita arquivos do workspace ou de Pastas Autorizadas (mesmo >100 MB).",
    parameters: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "Caminho relativo no workspace ou caminho absoluto dentro de Pastas Autorizadas.",
        },
        noise_db: {
          type: "number",
          description: "Limiar de silêncio em dB (padrão -32).",
        },
        min_silence_duration: {
          type: "number",
          description: "Duração mínima da pausa em segundos (padrão 0.45).",
        },
      },
      required: ["input_path"],
    },
  },
  {
    name: "video_transcribe_words",
    description:
      "Extrai áudio do vídeo e transcreve com timestamps palavra-por-palavra (Groq Whisper via Cofre ou fallback local) para legendas karaokê e detecção de cortes.",
    parameters: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "Caminho relativo no workspace ou caminho absoluto em Pastas Autorizadas.",
        },
        language: {
          type: "string",
          description: "Código de idioma opcional (ex.: 'pt').",
        },
      },
      required: ["input_path"],
    },
  },
  {
    name: "exec_ffmpeg_edit",
    description:
      "Edita e renderiza vídeo MP4 via FFmpeg local sem shell injection: corta pausas/erros (keep_segments), aplica aspecto (9:16/16:9/1:1), queima legendas (.ass/.srt) e mixa trilha sonora com ducking.",
    parameters: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "Caminho do vídeo bruto (workspace ou Pasta Autorizada).",
        },
        output_filename: {
          type: "string",
          description: "Nome do arquivo MP4 final salvo em saidas/videos/.",
        },
        keep_segments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              start: { type: "number" },
              end: { type: "number" },
            },
            required: ["start", "end"],
          },
          description: "Trechos [start, end] em segundos a manter após remover pausas/erros.",
        },
        subtitles_path: {
          type: "string",
          description: "Caminho opcional para arquivo .ass (karaokê) ou .srt.",
        },
        background_music_path: {
          type: "string",
          description: "Caminho opcional para trilha sonora em loop.",
        },
        music_volume: {
          type: "number",
          description: "Volume da trilha (0.02 a 1.0, padrão 0.12).",
        },
        aspect: {
          type: "string",
          enum: ["9:16", "16:9", "1:1", "original"],
          description: "Proporção de saída (padrão original).",
        },
      },
      required: ["input_path"],
    },
  },
];
