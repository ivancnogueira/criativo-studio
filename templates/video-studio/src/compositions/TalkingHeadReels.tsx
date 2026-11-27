import React from "react";
import { Audio, Sequence, Video, useCurrentFrame, useVideoConfig } from "remotion";
import { ZoomContainer } from "../components/ZoomContainer";
import { InfographicCard } from "../components/InfographicCard";
import { Subtitles, type WordToken } from "../components/Subtitles";
import { KenBurnsScene } from "../components/KenBurnsScene";
import { ColorGrade, type ColorGradePreset } from "../components/ColorGrade";

export interface BrollOverlay {
  id: string;
  mediaUrl: string;
  isVideo?: boolean;
  startInSeconds: number;
  durationInSeconds: number;
}

export interface SfxItem {
  id: string;
  soundUrl: string;
  startInSeconds: number;
  volume?: number;
}

export type TalkingHeadReelsProps = {
  mainVideoUrl?: string;
  audioPath?: string;
  backgroundMusicUrl?: string;
  musicVolume?: number;
  zoomMoments?: { startInSeconds: number; endInSeconds: number }[];
  brolls?: BrollOverlay[];
  infographics?: {
    id: string;
    type: "metric" | "step" | "alert" | "quote";
    title: string;
    subtitle?: string;
    highlightValue?: string;
    startInSeconds: number;
    durationInSeconds: number;
  }[];
  subtitlesWords?: WordToken[];
  brandHighlightColor?: string;
  colorGradePreset?: ColorGradePreset;
  sfxTracks?: SfxItem[];
};

export const TalkingHeadReels: React.FC<TalkingHeadReelsProps> = ({
  mainVideoUrl,
  audioPath,
  backgroundMusicUrl,
  musicVolume = 0.08,
  zoomMoments = [],
  brolls = [],
  infographics = [],
  subtitlesWords = [],
  brandHighlightColor = "#B9FC01",
  colorGradePreset = "dark-moody",
  sfxTracks = [],
}: TalkingHeadReelsProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;
  const resolvedVideo = mainVideoUrl || audioPath || "";

  const isZoomed = zoomMoments.some(
    (z) => currentTime >= z.startInSeconds && currentTime <= z.endInSeconds
  );

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: "#000000",
        position: "relative",
        width: "1080px",
        height: "1920px",
        overflow: "hidden",
      }}
    >
      {backgroundMusicUrl && (
        <Audio src={backgroundMusicUrl} volume={musicVolume} loop />
      )}

      {sfxTracks.map((sfx) => {
        const fromFrame = Math.round(sfx.startInSeconds * fps);
        return (
          <Sequence key={sfx.id} from={fromFrame} durationInFrames={Math.round(2 * fps)}>
            <Audio src={sfx.soundUrl} volume={sfx.volume ?? 0.6} />
          </Sequence>
        );
      })}

      <ColorGrade preset={colorGradePreset} brandGlowColor={brandHighlightColor}>
        <ZoomContainer isZoomed={isZoomed}>
          {resolvedVideo ? (
            <Video
              src={resolvedVideo}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
        </ZoomContainer>
      </ColorGrade>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          height: "450px",
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      {brolls.map((broll) => {
        const fromFrame = Math.round(broll.startInSeconds * fps);
        const durationFrames = Math.max(1, Math.round(broll.durationInSeconds * fps));

        return (
          <Sequence key={broll.id} from={fromFrame} durationInFrames={durationFrames}>
            <KenBurnsScene
              mediaUrl={broll.mediaUrl}
              isVideo={broll.isVideo}
              zoomDirection="in"
              durationInFrames={durationFrames}
            />
          </Sequence>
        );
      })}

      {infographics.map((info) => {
        const fromFrame = Math.round(info.startInSeconds * fps);
        const durationFrames = Math.max(1, Math.round(info.durationInSeconds * fps));

        return (
          <Sequence key={info.id} from={fromFrame} durationInFrames={durationFrames}>
            <InfographicCard
              type={info.type}
              title={info.title}
              subtitle={info.subtitle}
              highlightValue={info.highlightValue}
              brandColor={brandHighlightColor}
            />
          </Sequence>
        );
      })}

      <Subtitles words={subtitlesWords} highlightColor={brandHighlightColor} />
    </div>
  );
};
