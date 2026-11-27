import React from "react";
import { Composition } from "remotion";
import { FacelessReels, type FacelessReelsProps } from "./compositions/FacelessReels";
import { TalkingHeadReels, type TalkingHeadReelsProps } from "./compositions/TalkingHeadReels";

const calcDurationFrames = (props: Record<string, unknown>, fps = 30, fallbackSeconds = 15) => {
  const sec = Number(props.durationInSeconds);
  if (Number.isFinite(sec) && sec > 0) {
    return Math.max(fps, Math.ceil(sec * fps));
  }
  return fps * fallbackSeconds;
};

const defaultFacelessProps: FacelessReelsProps = {
  voiceAudioUrl: "",
  backgroundMusicUrl: "",
  musicVolume: 0.12,
  scenes: [],
  infographics: [],
  subtitlesWords: [],
  brandHighlightColor: "#B9FC01",
};

const defaultTalkingHeadProps: TalkingHeadReelsProps = {
  mainVideoUrl: "",
  backgroundMusicUrl: "",
  musicVolume: 0.08,
  zoomMoments: [],
  brolls: [],
  infographics: [],
  subtitlesWords: [],
  brandHighlightColor: "#B9FC01",
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition<any, FacelessReelsProps>
        id="ReelsFaceless"
        component={FacelessReels}
        durationInFrames={30 * 15}
        fps={30}
        width={1080}
        height={1920}
        calculateMetadata={({ props }) => ({
          durationInFrames: calcDurationFrames(props as Record<string, unknown>, 30, 15),
        })}
        defaultProps={defaultFacelessProps}
      />

      <Composition<any, FacelessReelsProps>
        id="FacelessReels"
        component={FacelessReels}
        durationInFrames={30 * 15}
        fps={30}
        width={1080}
        height={1920}
        calculateMetadata={({ props }) => ({
          durationInFrames: calcDurationFrames(props as Record<string, unknown>, 30, 15),
        })}
        defaultProps={defaultFacelessProps}
      />

      <Composition<any, TalkingHeadReelsProps>
        id="ReelsTalkingHead"
        component={TalkingHeadReels}
        durationInFrames={30 * 15}
        fps={30}
        width={1080}
        height={1920}
        calculateMetadata={({ props }) => ({
          durationInFrames: calcDurationFrames(props as Record<string, unknown>, 30, 15),
        })}
        defaultProps={defaultTalkingHeadProps}
      />

      <Composition<any, TalkingHeadReelsProps>
        id="TalkingHeadReels"
        component={TalkingHeadReels}
        durationInFrames={30 * 15}
        fps={30}
        width={1080}
        height={1920}
        calculateMetadata={({ props }) => ({
          durationInFrames: calcDurationFrames(props as Record<string, unknown>, 30, 15),
        })}
        defaultProps={defaultTalkingHeadProps}
      />
    </>
  );
};
