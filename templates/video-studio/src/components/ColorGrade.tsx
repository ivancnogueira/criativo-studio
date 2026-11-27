import React from "react";

export type ColorGradePreset =
  | "none"
  | "dark-moody"
  | "teal-orange"
  | "apple-clean"
  | "cyberpunk"
  | "warm-vintage";

export interface ColorGradeProps {
  preset?: ColorGradePreset;
  children: React.ReactNode;
  enableVignette?: boolean;
  brandGlowColor?: string;
}

export const ColorGrade: React.FC<ColorGradeProps> = ({
  preset = "dark-moody",
  children,
  enableVignette = true,
  brandGlowColor,
}: ColorGradeProps) => {
  let filterCss = "none";

  switch (preset) {
    case "dark-moody":
      filterCss = "contrast(1.18) brightness(0.92) saturate(1.12)";
      break;
    case "teal-orange":
      filterCss = "contrast(1.22) saturate(1.25) sepia(0.12)";
      break;
    case "apple-clean":
      filterCss = "contrast(1.08) brightness(1.05) saturate(1.05)";
      break;
    case "cyberpunk":
      filterCss = "contrast(1.25) saturate(1.35) hue-rotate(10deg)";
      break;
    case "warm-vintage":
      filterCss = "contrast(1.05) brightness(0.96) sepia(0.22) saturate(1.15)";
      break;
    case "none":
    default:
      filterCss = "none";
      break;
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "#05070D",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          filter: filterCss,
          transition: "filter 0.3s ease",
        }}
      >
        {children}
      </div>

      {enableVignette && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at center, transparent 45%, rgba(0, 0, 0, 0.6) 100%)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      )}

      {brandGlowColor && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow: `inset 0 0 80px ${brandGlowColor}22`,
            pointerEvents: "none",
            zIndex: 11,
          }}
        />
      )}
    </div>
  );
};
