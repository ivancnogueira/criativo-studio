/**
 * Estados oculares originais do mascote clássico ("classic") preservados para inspeção e retrocompatibilidade.
 */
export const CLASSIC_MASCOT_EYE_FACES = [
  "resting",
  "wink",
  "surpris",
  "curieux",
  "excite",
  "attentif",
  "squint",
  "focused",
  "wide",
] as const;

export {
  AVATAR_STYLES,
  AVATAR_VARIANTS_BY_STYLE,
  CLASSIC_SHAPE_PATHS,
  getDefaultMascotForAgent,
  getDefaultVariantForStyle,
  isValidVariantForStyle,
  MASCOT_COLOR_PALETTE,
  MASCOT_SHAPES,
  normalizeAvatarStyle,
  resolveAgentAvatarConfig,
} from "./avatars/avatar-catalog";
export {
  inferTaskContextFromActivity,
  TASK_EXPRESSION_PLAYLISTS,
  type AgentAvatarVisual,
  type AvatarExpression,
  type AvatarStyle,
  type AvatarStyleMeta,
  type AvatarTaskContext,
  type AvatarVariantSpec,
} from "./avatars/avatar-types";
export {
  ChannelMascoteCluster,
  MascoteAvatar,
  type ChannelMascoteClusterProps,
  type MascoteAvatarProps,
  type MascotEyeMood,
} from "./avatars/MascoteAvatarBase";
export {
  AvatarAppearancePicker,
  MascoteAppearancePicker,
  type MascoteAppearancePickerProps,
} from "./avatars/AvatarAppearancePicker";
