import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

export interface WordToken {
  word: string;
  start: number;
  end: number;
}

export interface SubtitlesProps {
  words: WordToken[];
  highlightColor?: string;
  textColor?: string;
  fontSize?: number;
}

export const Subtitles: React.FC<SubtitlesProps> = ({
  words = [],
  highlightColor = "#B9FC01",
  textColor = "#FFFFFF",
  fontSize = 62,
}: SubtitlesProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  if (!words || words.length === 0) return null;

  const activeWordIndex = words.findIndex(
    (w: WordToken) => currentTime >= w.start && currentTime <= w.end
  );

  if (activeWordIndex === -1) {
    const lastWord = [...words].reverse().find((w: WordToken) => currentTime >= w.end);
    if (!lastWord || currentTime - lastWord.end > 0.6) {
      return null;
    }
  }

  const currentIdx = activeWordIndex !== -1 ? activeWordIndex : 0;
  const windowSize = 4;
  const windowStart = Math.floor(currentIdx / windowSize) * windowSize;
  const currentChunk = words.slice(windowStart, windowStart + windowSize);

  return (
    <div
      style={{
        position: "absolute",
        bottom: "220px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "90%",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "14px",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      {currentChunk.map((item, idx) => {
        const isCurrent = currentTime >= item.start && currentTime <= item.end;
        const scale = isCurrent ? 1.15 : 1.0;
        const color = isCurrent ? highlightColor : textColor;

        return (
          <span
            key={`${windowStart}-${idx}`}
            style={{
              fontFamily: "'Montserrat', 'Inter', 'Arial Black', sans-serif",
              fontSize: `${fontSize}px`,
              fontWeight: 900,
              textTransform: "uppercase",
              color,
              transform: `scale(${scale})`,
              transition: "transform 0.08s ease-out, color 0.08s ease-out",
              textShadow:
                "0 4px 18px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.9), 0 0 1px #000",
              letterSpacing: "1px",
              padding: "4px 8px",
              borderRadius: "8px",
              backgroundColor: isCurrent ? "rgba(0, 0, 0, 0.45)" : "transparent",
              backdropFilter: isCurrent ? "blur(4px)" : "none",
              display: "inline-block",
            }}
          >
            {item.word}
          </span>
        );
      })}
    </div>
  );
};
