import type { AgenteRegistro, AvatarShape, AvatarStyle } from "@criativo/contracts";
import type {
  AgentAvatarVisual,
  AvatarStyleMeta,
  AvatarVariantSpec,
} from "./avatar-types";

/**
 * 17 cores fiéis às duas fileiras do construtor de mascotes do CriativoOS.
 */
export const MASCOT_COLOR_PALETTE: readonly string[] = [
  "#38bdf8",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#2dd4bf",
  "#67e8f9",
  "#3b82f6",
  "#34479c",
  "#6366f1",
  "#a855f7",
  "#d946ef",
  "#f27ba5",
  "#a8324e",
  "#8b5e3c",
  "#d6b98c",
];

export const MASCOT_SHAPES: readonly { id: AvatarShape; label: string }[] = [
  { id: "blob", label: "Redondo" },
  { id: "pill", label: "Pílula" },
  { id: "triangle", label: "Triângulo" },
  { id: "cloud", label: "Nuvem" },
  { id: "hex", label: "Hexágono" },
  { id: "rounded_square", label: "Cubo" },
  { id: "octo", label: "Estrela" },
  { id: "diamond", label: "Losango" },
];

export const CLASSIC_SHAPE_PATHS: Record<AvatarShape, string> = {
  blob: "M50 11 C73 11 89 26 89 49 C89 72 74 89 50 89 C26 89 11 72 11 49 C11 26 27 11 50 11 Z",
  pill: "M50 10 C71 10 83 22 83 41 L83 60 C83 78 70 90 50 90 C30 90 17 78 17 60 L17 41 C17 22 29 10 50 10 Z",
  triangle:
    "M50 10 C56 10 61 14 66 22 L85 59 C90 70 84 85 71 86 L29 86 C16 85 10 70 15 59 L34 22 C39 14 44 10 50 10 Z",
  cloud:
    "M32 30 C39 17 61 17 68 30 C82 30 90 42 86 55 C91 69 78 85 63 83 C56 90 44 90 37 83 C22 85 9 69 14 55 C10 42 18 30 32 30 Z",
  hex: "M42 12 C47 9 53 9 58 12 L81 26 C86 29 89 35 89 41 L89 60 C89 66 86 72 81 75 L58 89 C53 92 47 92 42 89 L19 75 C14 72 11 66 11 60 L11 41 C11 35 14 29 19 26 Z",
  rounded_square:
    "M32 13 L68 13 C80 13 87 20 87 32 L87 68 C87 80 80 87 68 87 L32 87 C20 87 13 80 13 68 L13 32 C13 20 20 13 32 13 Z",
  octo: "M50 9 L64 17 L80 19 L84 35 L91 50 L84 65 L80 81 L64 83 L50 91 L36 83 L20 81 L16 65 L9 50 L16 35 L20 19 L36 17 Z",
  diamond:
    "M50 8 C54 8 58 10 62 14 L86 38 C92 44 92 56 86 62 L62 86 C56 92 44 92 38 86 L14 62 C8 56 8 44 14 38 L38 14 C42 10 46 8 50 8 Z",
};

/**
 * Exatamente os 8 estilos selecionáveis aprovados (sem Pixel Art e sem Orbe Holograma).
 */
export const AVATAR_STYLES: readonly AvatarStyleMeta[] = [
  {
    id: "classic",
    label: "Clássico",
    shortLabel: "Clássico",
    description: "Mascotes 3D originais do estúdio com olhos expressivos.",
  },
  {
    id: "plush",
    label: "Plush+",
    shortLabel: "Plush+",
    description: "Pelúcias 3D com acessórios variados e 16 expressões completas.",
  },
  {
    id: "cartoon",
    label: "Carinhas Cartoon",
    shortLabel: "Cartoon",
    description: "Bocas, olhões e sobrancelhas cartunescas cheias de atitude.",
  },
  {
    id: "robots",
    label: "Robozinhos",
    shortLabel: "Robôs",
    description: "Chassis tecnológicos com visor LED neon e equalizador ao falar.",
  },
  {
    id: "personas",
    label: "Personagens",
    shortLabel: "Personagens",
    description: "Arquétipos ilustrados de criadores, estrategistas e especialistas.",
  },
  {
    id: "pets",
    label: "Bichinhos",
    shortLabel: "Bichinhos",
    description: "Mascotes animais cheios de personalidade e orelhinhas vivas.",
  },
  {
    id: "monsters",
    label: "Monstrinhos",
    shortLabel: "Monstrinhos",
    description: "Criaturas divertidas de ciclope a alienígena reagindo ao vivo.",
  },
  {
    id: "image",
    label: "Foto / IA",
    shortLabel: "Foto / IA",
    description: "Suba uma imagem sua ou crie um avatar exclusivo com IA.",
  },
];

export const AVATAR_VARIANTS_BY_STYLE: Record<AvatarStyle, readonly AvatarVariantSpec[]> = {
  classic: MASCOT_SHAPES.map((s) => ({ id: s.id, label: s.label })),
  plush: [
    { id: "plush_classic", label: "Clássico 3D" },
    { id: "plush_shades", label: "Óculos Escuros" },
    { id: "plush_glasses", label: "Óculos Geek" },
    { id: "plush_headphones", label: "Fones Studio" },
    { id: "plush_crown", label: "Coroa Real" },
    { id: "plush_cap", label: "Boné Urbano" },
    { id: "plush_beanie", label: "Gorro Inverno" },
    { id: "plush_halo", label: "Auréola Brilhante" },
    { id: "plush_bow", label: "Lacinho" },
    { id: "plush_horns", label: "Chifrinhos" },
    { id: "plush_antenna", label: "Anteninha" },
    { id: "plush_beret", label: "Boina Criativa" },
    { id: "plush_wizard", label: "Chapéu Mago" },
    { id: "plush_leaf", label: "Folhinha Zen" },
    { id: "plush_chef", label: "Chapéu Chef" },
    { id: "plush_star", label: "Estrela Plush" },
    { id: "plush_cloud", label: "Nuvem Plush" },
    { id: "plush_hex", label: "Hexágono Plush" },
    { id: "plush_diamond", label: "Diamante Plush" },
    { id: "plush_bandana", label: "Faixa Ninja" },
  ],
  cartoon: [
    { id: "cart_squircle", label: "Quadrado Suave" },
    { id: "cart_circle", label: "Redondo" },
    { id: "cart_pillow", label: "Almofada" },
    { id: "cart_drop", label: "Gota" },
    { id: "cart_cloud", label: "Nuvem" },
    { id: "cart_star", label: "Estrela" },
    { id: "cart_shield", label: "Escudo" },
    { id: "cart_ticket", label: "Selo" },
    { id: "cart_hex", label: "Hexágono" },
    { id: "cart_cap", label: "Com Boné" },
    { id: "cart_crown", label: "Com Coroa" },
    { id: "cart_headphones", label: "Com Fones" },
    { id: "cart_shades", label: "Com Óculos" },
    { id: "cart_glasses", label: "Com Armação" },
    { id: "cart_tophat", label: "Cartola" },
    { id: "cart_beret", label: "Boina" },
    { id: "cart_sprout", label: "Brotinho" },
    { id: "cart_lightning", label: "Raio" },
    { id: "cart_ears", label: "Orelhinhas" },
    { id: "cart_visor", label: "Viseira Tech" },
  ],
  robots: [
    { id: "bot_visor", label: "Visor Clássico" },
    { id: "bot_antenna", label: "Antena Única" },
    { id: "bot_dual_ant", label: "Antenas Duplas" },
    { id: "bot_crt", label: "Monitor Retrô" },
    { id: "bot_drone", label: "Drone Esférico" },
    { id: "bot_mech", label: "Mecha Blindado" },
    { id: "bot_cat", label: "Cyber Gato" },
    { id: "bot_bunny", label: "Cyber Coelho" },
    { id: "bot_crown", label: "Robô Rei" },
    { id: "bot_headphones", label: "DJ Bot" },
    { id: "bot_cyclops", label: "Visor Panorâmico" },
    { id: "bot_radar", label: "Radar Parabólico" },
    { id: "bot_astro", label: "Astro Bot" },
    { id: "bot_ninja", label: "Cyber Ninja" },
    { id: "bot_cube", label: "Cubo Blindado" },
    { id: "bot_capsule", label: "Cápsula Aero" },
    { id: "bot_hex", label: "Núcleo Hex" },
    { id: "bot_retro_tv", label: "TV Tubo" },
    { id: "bot_shield", label: "Guardião" },
    { id: "bot_halo", label: "Anjo Bot" },
  ],
  personas: [
    { id: "per_heisenberg", label: "Fedora & Cavanhaque" },
    { id: "per_catgirl", label: "Orelhinhas de Gato" },
    { id: "per_vampire", label: "Conde Gótico" },
    { id: "per_bun", label: "Coque Clássico" },
    { id: "per_ninja", label: "Folha & Faixa" },
    { id: "per_long_dark", label: "Cabelo Longo" },
    { id: "per_agent", label: "Criativo Escuros" },
    { id: "per_gamer", label: "Headset Gamer" },
    { id: "per_paperbag", label: "Misterioso" },
    { id: "per_senior", label: "Barba & Óculos" },
    { id: "per_pigtails", label: "Maria-Chiquinha" },
    { id: "per_cap_creator", label: "Criador Boné" },
    { id: "per_afro", label: "Black Power" },
    { id: "per_bob", label: "Corte Bob" },
    { id: "per_beret", label: "Artista Boina" },
    { id: "per_chef", label: "Chef Criativo" },
    { id: "per_astro", label: "Astronauta" },
    { id: "per_punk", label: "Moicano Punk" },
    { id: "per_royal", label: "Coroa Real" },
    { id: "per_cyber", label: "Viseira Cyber" },
  ],
  pets: [
    { id: "pet_cat", label: "Gatinho" },
    { id: "pet_dog", label: "Cachorrinho" },
    { id: "pet_fox", label: "Raposa" },
    { id: "pet_owl", label: "Coruja" },
    { id: "pet_bear", label: "Urso" },
    { id: "pet_bunny", label: "Coelho" },
    { id: "pet_panda", label: "Panda" },
    { id: "pet_frog", label: "Sapo" },
    { id: "pet_penguin", label: "Pinguim" },
    { id: "pet_lion", label: "Leão" },
    { id: "pet_tiger", label: "Tigre" },
    { id: "pet_deer", label: "Cervo" },
    { id: "pet_octopus", label: "Polvo" },
    { id: "pet_bee", label: "Abelha" },
    { id: "pet_dragon", label: "Dragãozinho" },
    { id: "pet_capybara", label: "Capivara" },
    { id: "pet_axolotl", label: "Axolote" },
    { id: "pet_raccoon", label: "Guaxinim" },
    { id: "pet_wolf", label: "Lobo" },
    { id: "pet_chick", label: "Pintinho" },
  ],
  monsters: [
    { id: "mon_cyclops", label: "Ciclope" },
    { id: "mon_horned", label: "Chifrudo" },
    { id: "mon_tri_eye", label: "Três Olhos" },
    { id: "mon_tentacle", label: "Tentáculos" },
    { id: "mon_ghost", label: "Fantasminha" },
    { id: "mon_slime", label: "Slime Bolha" },
    { id: "mon_yeti", label: "Yeti Peludo" },
    { id: "mon_imp", label: "Diabinho" },
    { id: "mon_alien", label: "Alienígena" },
    { id: "mon_cactus", label: "Cacto Vivo" },
    { id: "mon_mushroom", label: "Cogumelo" },
    { id: "mon_bat", label: "Morceguinho" },
    { id: "mon_crystal", label: "Golem Cristal" },
    { id: "mon_storm", label: "Nuvem Trovão" },
    { id: "mon_dino", label: "Dinossauro" },
    { id: "mon_shark", label: "Tubarãozinho" },
    { id: "mon_berry", label: "Morangostrinho" },
    { id: "mon_pumpkin", label: "Abóbora" },
    { id: "mon_jelly", label: "Água-Viva" },
    { id: "mon_starfish", label: "Estrela-do-Mar" },
  ],
  image: [],
};

const VALID_STYLES = new Set<AvatarStyle>(AVATAR_STYLES.map((s) => s.id));

export function normalizeAvatarStyle(raw: unknown): AvatarStyle {
  return typeof raw === "string" && VALID_STYLES.has(raw as AvatarStyle)
    ? (raw as AvatarStyle)
    : "classic";
}

export function getDefaultMascotForAgent(agentId: string): { shape: AvatarShape; color: string } {
  const hash = Array.from(agentId).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const shapes: AvatarShape[] = [
    "hex",
    "blob",
    "diamond",
    "rounded_square",
    "triangle",
    "cloud",
    "octo",
    "pill",
  ];
  return {
    shape: shapes[hash % shapes.length],
    color: MASCOT_COLOR_PALETTE[hash % MASCOT_COLOR_PALETTE.length],
  };
}

export function getDefaultVariantForStyle(
  style: AvatarStyle,
  fallbackShape: AvatarShape = "blob"
): string {
  if (style === "classic") return fallbackShape;
  if (style === "image") return "custom_image";
  return AVATAR_VARIANTS_BY_STYLE[style]?.[0]?.id ?? fallbackShape;
}

export function isValidVariantForStyle(style: AvatarStyle, variant?: string | null): boolean {
  if (!variant) return false;
  if (style === "image") return true;
  return (AVATAR_VARIANTS_BY_STYLE[style] ?? []).some((v) => v.id === variant);
}

/**
 * Resolve toda a configuração visual do avatar de um agente com retrocompatibilidade total.
 */
export function resolveAgentAvatarConfig(
  ag?: AgenteRegistro | null,
  fallbackAgentId = "estrategista"
): AgentAvatarVisual {
  const fb = getDefaultMascotForAgent(ag?.agente_id ?? fallbackAgentId);
  const cfg = (ag?.config ?? {}) as Record<string, unknown>;
  const shape = (typeof cfg.avatar_shape === "string" ? cfg.avatar_shape : fb.shape) as AvatarShape;
  const color = typeof cfg.avatar_color === "string" ? cfg.avatar_color : fb.color;
  const style = normalizeAvatarStyle(cfg.avatar_style);
  const rawVariant = typeof cfg.avatar_variant === "string" ? cfg.avatar_variant : "";
  const variant = isValidVariantForStyle(style, rawVariant)
    ? rawVariant
    : getDefaultVariantForStyle(style, shape);
  const imageUrl =
    typeof cfg.avatar_image_url === "string" && cfg.avatar_image_url.trim()
      ? cfg.avatar_image_url.trim()
      : null;

  if (style === "image" && !imageUrl) {
    return {
      style: "image",
      shape,
      variant: "custom_image",
      color,
      imageUrl: null,
    };
  }

  return { style, shape, variant, color, imageUrl };
}
