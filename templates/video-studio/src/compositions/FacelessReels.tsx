import React from "react";
import { Audio, Sequence, useVideoConfig } from "remotion";
import { KenBurnsScene } from "../components/KenBurnsScene";
import { InfographicCard } from "../components/InfographicCard";
import { Subtitles, type WordToken } from "../components/Subtitles";
import { ColorGrade, type ColorGradePreset } from "../components/ColorGrade";

export interface SceneItem {
  id: string;
  mediaUrl: string;
  isVideo?: boolean;
  startInSeconds: number;
  durationInSeconds: number;
  zoomDirection?: "in" | "out";
}

export interface InfographicItem {
  id: string;
  type: "metric" | "step" | "alert" | "quote";
  title: string;
  subtitle?: string;
  highlightValue?: string;
  startInSeconds: number;
  durationInSeconds: number;
}

export interface SfxItem {
  id: string;
  soundUrl: string;
  startInSeconds: number;
  volume?: number;
}

export type FacelessReelsProps = {
  voiceAudioUrl?: string;
  audioPath?: string;
  backgroundMusicUrl?: string;
  musicVolume?: number;
  scenes?: SceneItem[];
  infographics?: InfographicItem[];
  subtitlesWords?: WordToken[];
  brandHighlightColor?: string;
  colorGradePreset?: ColorGradePreset;
  sfxTracks?: SfxItem[];
};

export const FacelessReels: React.FC<FacelessReelsProps> = ({
  voiceAudioUrl,
  audioPath,
  backgroundMusicUrl,
  musicVolume = 0.12,
  scenes = [],
  infographics = [],
  subtitlesWords = [],
  brandHighlightColor = "#B9FC01",
  colorGradePreset = "dark-moody",
  sfxTracks = [],
}: FacelessReelsProps) => {
  const { fps } = useVideoConfig();
  const resolvedAudio = voiceAudioUrl || audioPath || "";

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: "#05070D",
        position: "relative",
        width: "1080px",
        height: "1920px",
        overflow: "hidden",
      }}
    >
      {backgroundMusicUrl && (
        <Audio src={backgroundMusicUrl} volume={musicVolume} loop />
      )}

      {resolvedAudio && <Audio src={resolvedAudio} volume={1.0} />}

      {sfxTracks.map((sfx) => {
        const fromFrame = Math.round(sfx.startInSeconds * fps);
        return (
          <Sequence key={sfx.id} from={fromFrame} durationInFrames={Math.round(2 * fps)}>
            <Audio src={sfx.soundUrl} volume={sfx.volume ?? 0.6} />
          </Sequence>
        );
      })}

      <ColorGrade preset={colorGradePreset} brandGlowColor={brandHighlightColor}>
        {scenes.map((scene) => {
          const fromFrame = Math.round(scene.startInSeconds * fps);
          const durationFrames = Math.max(1, Math.round(scene.durationInSeconds * fps));

          return (
            <Sequence key={scene.id} from={fromFrame} durationInFrames={durationFrames}>
              <KenBurnsScene
                mediaUrl={scene.mediaUrl}
                isVideo={scene.isVideo}
                zoomDirection={scene.zoomDirection || "in"}
                durationInFrames={durationFrames}
              />
            </Sequence>
          );
        })}
      </ColorGrade>

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
