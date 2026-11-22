import React from "react";
import type {
  AvatarExpression,
} from "./avatar-types";
export * from "./avatar-face-overlays";

export interface AvatarFaceRigProps {
  expression: AvatarExpression;
  talkPhase?: number;
  blink?: boolean;
  gazeX?: number;
  gazeY?: number;
  cx?: number;
  cy?: number;
  scale?: number;
  lineColor?: string;
  eyeWhite?: string;
  pupilColor?: string;
  lidColor?: string;
  isRobot?: boolean;
  eyeMode?: "duo" | "cyclops" | "tri";
  glowAccent?: string;
}

/**
 * Motor facial unificado com as 16 expressões Cartoon + modo "talking" em 4 fases silábicas.
 * Sempre renderizado na camada "avatar-face-rig" ANTES de qualquer óculos/viseira.
 */
export const AvatarFaceRig: React.FC<AvatarFaceRigProps> = ({
  expression,
  talkPhase = 1,
  blink = false,
  gazeX = 0,
  gazeY = 0,
  cx = 50,
  cy = 52,
  scale = 1,
  lineColor = "#18181b",
  eyeWhite = "#ffffff",
  pupilColor = "#18181b",
  lidColor = "#3f3f46",
  isRobot = false,
  eyeMode = "duo",
}) => {
  const stroke = isRobot ? eyeWhite : lineColor;
  const effPhase = ((talkPhase % 4) + 4) % 4;
  const gx = gazeX.toFixed(2);
  const gy = gazeY.toFixed(2);
  const pupilTransform = `translate(${gx}px, ${gy}px)`;
  const blinkTransform = blink ? "scaleY(0.1)" : "scaleY(1)";

  const renderBrows = () => {
    if (isRobot || expression === "sleep" || expression === "cry") return null;
    if (expression === "fierce") {
      return (
        <g>
          <path d="M -27 -27 L -6 -16" fill="none" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" />
          <path d="M 27 -27 L 6 -16" fill="none" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" />
        </g>
      );
    }
    if (expression === "smug") {
      return (
        <g>
          <path d="M -26 -24 L -7 -19" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
          <path d="M 7 -19 Q 18 -27 27 -22" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    }
    if (expression === "wink") {
      return (
        <g>
          <path d="M -27 -23 Q -15 -31 -4 -24" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
          <path d="M 5 -19 Q 16 -23 26 -17" fill="none" stroke={stroke} strokeWidth="2.8" strokeLinecap="round" />
        </g>
      );
    }
    if (expression === "bored" || expression === "dizzy") {
      return (
        <g>
          <path d="M -26 -20 Q -15 -27 -6 -22" fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M 6 -22 Q 15 -27 26 -20" fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" />
        </g>
      );
    }
    return (
      <g>
        <path d="M -25 -24 Q -14 -31 -5 -24" fill="none" stroke={stroke} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M 5 -24 Q 14 -31 25 -24" fill="none" stroke={stroke} strokeWidth="2.8" strokeLinecap="round" />
      </g>
    );
  };

  const renderCyclopsEye = () => {
    if (expression === "sleep") {
      return <path d="M -18 -7 Q 0 2 18 -7" fill="none" stroke={stroke} strokeWidth="3.8" strokeLinecap="round" />;
    }
    if (expression === "cheeky") {
      return <path d="M -17 -15 L 4 -7 L -16 1" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />;
    }
    if (expression === "love") {
      return (
        <g>
          <path
            d="M 0 6 C -16 -5 -22 -18 -13 -25 C -7 -29 -1 -25 0 -20 C 1 -25 7 -29 13 -25 C 22 -18 16 -5 0 6 Z"
            fill="#e11d48"
            stroke={stroke}
            strokeWidth="2.4"
          />
          <circle cx="-6" cy="-16" r="2.6" fill="#fff" opacity="0.85" />
        </g>
      );
    }
    if (expression === "cash") {
      return (
        <g>
          <circle cx="0" cy="-9" r="18" fill={eyeWhite} stroke={stroke} strokeWidth="2.6" />
          <text
            x="0"
            y="-2"
            textAnchor="middle"
            fontSize="22"
            fontWeight="900"
            fill={isRobot ? pupilColor : "#0f172a"}
          >
            $
          </text>
        </g>
      );
    }
    if (expression === "cry") {
      return (
        <g>
          <path d="M -18 -9 Q 0 -17 18 -9" fill="none" stroke={stroke} strokeWidth="3.8" strokeLinecap="round" />
          <path d="M -18 -7 Q -34 -4 -37 5 Q -28 8 -16 -2 Z" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.4" />
          <path d="M 18 -7 Q 34 -4 37 5 Q 28 8 16 -2 Z" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.4" />
        </g>
      );
    }
    const r = expression === "shock" || expression === "wow" ? 20 : 18;
    return (
      <g style={{ transform: blinkTransform, transformOrigin: "0px -9px", transition: "transform 110ms ease" }}>
        <circle cx="0" cy="-9" r={r} fill={eyeWhite} stroke={stroke} strokeWidth="2.6" />
        <g style={{ transform: pupilTransform, transition: "transform 150ms cubic-bezier(0.22,1,0.36,1)" }}>
          <circle cx="0" cy="-9" r={7.2} fill={pupilColor} />
          <circle cx="-2.6" cy="-12" r="2.6" fill="#fff" />
        </g>
        {(expression === "bored" || expression === "smug") && (
          <path d={`M ${-r} -9 A ${r} ${r} 0 0 1 ${r} -9 Q 0 -5 ${-r} -9 Z`} fill={lidColor} stroke={stroke} strokeWidth="2.2" />
        )}
        {expression === "fierce" && (
          <>
            <path d={`M ${-r} -14 L ${r} -6 L ${r} -28 L ${-r} -28 Z`} fill={lidColor} />
            <line x1={-r} y1="-14" x2={r} y2="-6" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
          </>
        )}
      </g>
    );
  };

  const renderDuoEyes = () => {
    if (expression === "wink") {
      return (
        <g>
          <g style={{ transform: blinkTransform, transformOrigin: "-14px -7px", transition: "transform 110ms ease" }}>
            <ellipse cx="-14" cy="-7" rx="13.5" ry="15" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform, transition: "transform 150ms cubic-bezier(0.22,1,0.36,1)" }}>
              <circle cx="-11" cy="-6" r="5.5" fill={pupilColor} />
              <circle cx="-13" cy="-8.5" r="2" fill="#fff" />
            </g>
          </g>
          <path d="M 4 -8 Q 16 -14 27 -7" fill="none" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" />
          <path d="M 5 -5 Q 15 -8 24 -2" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
        </g>
      );
    }

    if (expression === "cheeky") {
      return (
        <g>
          <path d="M -26 -16 L -7 -7 L -25 1" fill="none" stroke={stroke} strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M 26 -16 L 7 -7 L 25 1" fill="none" stroke={stroke} strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    }

    if (expression === "bored") {
      return (
        <g>
          <g style={{ transform: blinkTransform, transformOrigin: "-13.5px -7px" }}>
            <circle cx="-13.5" cy="-7" r="13" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="-12" cy="-5" r="5" fill={pupilColor} />
              <circle cx="-13.5" cy="-7" r="1.6" fill="#fff" />
            </g>
            <path d="M -26.5 -7 A 13 13 0 0 1 0 -7 Q -13 -3 -26.5 -7 Z" fill={lidColor} stroke={stroke} strokeWidth="2.2" />
          </g>
          <g style={{ transform: blinkTransform, transformOrigin: "13.5px -7px" }}>
            <circle cx="13.5" cy="-7" r="13" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="12" cy="-5" r="5" fill={pupilColor} />
              <circle cx="10.5" cy="-7" r="1.6" fill="#fff" />
            </g>
            <path d="M 0 -7 A 13 13 0 0 1 26.5 -7 Q 13 -3 0 -7 Z" fill={lidColor} stroke={stroke} strokeWidth="2.2" />
          </g>
        </g>
      );
    }

    if (expression === "cash") {
      return (
        <g>
          <circle cx="-13.5" cy="-8" r="13.5" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
          <text
            x="-13.5"
            y="-2"
            textAnchor="middle"
            fontSize="18"
            fontWeight="900"
            fill={isRobot ? pupilColor : "#0f172a"}
          >
            $
          </text>
          <circle cx="13.5" cy="-8" r="13.5" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
          <text
            x="13.5"
            y="-2"
            textAnchor="middle"
            fontSize="18"
            fontWeight="900"
            fill={isRobot ? pupilColor : "#0f172a"}
          >
            $
          </text>
        </g>
      );
    }

    if (expression === "fierce") {
      return (
        <g>
          <g style={{ transform: blinkTransform, transformOrigin: "-13.5px -6px" }}>
            <circle cx="-13.5" cy="-6" r="13" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="-11" cy="-5" r="5" fill={pupilColor} />
              <circle cx="-12.5" cy="-7" r="1.6" fill="#fff" />
            </g>
            <path d="M -26 -13 L -1 -5 L -1 -19 L -26 -19 Z" fill={lidColor} />
            <line x1="-26" y1="-13" x2="-1" y2="-5" stroke={stroke} strokeWidth="2.8" strokeLinecap="round" />
          </g>
          <g style={{ transform: blinkTransform, transformOrigin: "13.5px -6px" }}>
            <circle cx="13.5" cy="-6" r="13" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="11" cy="-5" r="5" fill={pupilColor} />
              <circle cx="9.5" cy="-7" r="1.6" fill="#fff" />
            </g>
            <path d="M 26 -13 L 1 -5 L 1 -19 L 26 -19 Z" fill={lidColor} />
            <line x1="26" y1="-13" x2="1" y2="-5" stroke={stroke} strokeWidth="2.8" strokeLinecap="round" />
          </g>
        </g>
      );
    }

    if (expression === "sleep") {
      return (
        <g>
          <path d="M -27 -5 Q -15 3 -3 -5" fill="none" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" />
          <path d="M 3 -5 Q 15 3 27 -5" fill="none" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" />
        </g>
      );
    }

    if (expression === "sweet") {
      return (
        <g>
          <line x1="-25" y1="-12" x2="-30" y2="-16" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
          <line x1="25" y1="-12" x2="30" y2="-16" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
          <g style={{ transform: blinkTransform, transformOrigin: "-13.5px -7px" }}>
            <circle cx="-13.5" cy="-7" r="13" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="-11" cy="-7" r="5.2" fill={pupilColor} />
              <circle cx="-13" cy="-9" r="1.8" fill="#fff" />
            </g>
          </g>
          <g style={{ transform: blinkTransform, transformOrigin: "13.5px -7px" }}>
            <circle cx="13.5" cy="-7" r="13" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="11" cy="-7" r="5.2" fill={pupilColor} />
              <circle cx="9" cy="-9" r="1.8" fill="#fff" />
            </g>
          </g>
        </g>
      );
    }

    if (expression === "smug") {
      return (
        <g>
          <g style={{ transform: blinkTransform, transformOrigin: "-13.5px -8px" }}>
            <circle cx="-13.5" cy="-8" r="12.5" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="-10" cy="-7" r="4.8" fill={pupilColor} />
              <circle cx="-11.5" cy="-9" r="1.6" fill="#fff" />
            </g>
            <path d="M -26 -8 A 12.5 12.5 0 0 1 0 -8 L -26 -8 Z" fill={lidColor} stroke={stroke} strokeWidth="2.2" />
          </g>
          <g style={{ transform: blinkTransform, transformOrigin: "13.5px -8px" }}>
            <circle cx="13.5" cy="-8" r="12.5" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="16" cy="-7" r="4.8" fill={pupilColor} />
              <circle cx="14.5" cy="-9" r="1.6" fill="#fff" />
            </g>
            <path d="M 0 -8 A 12.5 12.5 0 0 1 26 -8 L 0 -8 Z" fill={lidColor} stroke={stroke} strokeWidth="2.2" />
          </g>
        </g>
      );
    }

    if (expression === "dizzy") {
      return (
        <g>
          <g style={{ transform: blinkTransform, transformOrigin: "-12.5px -8px" }}>
            <circle cx="-12.5" cy="-8" r="12.5" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="-14" cy="-9" r="4.6" fill={pupilColor} />
            </g>
            <path d="M -25 -5 A 12.5 12.5 0 0 0 0 -5 Z" fill={lidColor} stroke={stroke} strokeWidth="2" />
          </g>
          <g style={{ transform: blinkTransform, transformOrigin: "12.5px -8px" }}>
            <circle cx="12.5" cy="-8" r="12.5" fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
            <g style={{ transform: pupilTransform }}>
              <circle cx="10" cy="-7" r="4.6" fill={pupilColor} />
            </g>
            <path d="M 0 -5 A 12.5 12.5 0 0 0 25 -5 Z" fill={lidColor} stroke={stroke} strokeWidth="2" />
          </g>
        </g>
      );
    }

    if (expression === "cry") {
      return (
        <g>
          <path d="M -27 -8 Q -15 -14 -5 -8" fill="none" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" />
          <path d="M 5 -8 Q 15 -14 27 -8" fill="none" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" />
          <g>
            <path d="M -24 -6 Q -37 -4 -40 4 Q -32 7 -22 -2 Z" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.3" />
            <path d="M 24 -6 Q 37 -4 40 4 Q 32 7 22 -2 Z" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.3" />
          </g>
        </g>
      );
    }

    if (expression === "love") {
      return (
        <g>
          <path
            d="M -14 3 C -26 -5 -30 -15 -23 -20 C -19 -23 -15 -20 -14 -16 C -13 -20 -9 -23 -5 -20 C 2 -15 -2 -5 -14 3 Z"
            fill="#e11d48"
            stroke={stroke}
            strokeWidth="2.2"
          />
          <circle cx="-19" cy="-14" r="2.2" fill="#fff" opacity="0.8" />
          <path
            d="M 14 3 C 2 -5 -2 -15 5 -20 C 9 -23 13 -20 14 -16 C 15 -20 19 -23 23 -20 C 30 -15 26 -5 14 3 Z"
            fill="#e11d48"
            stroke={stroke}
            strokeWidth="2.2"
          />
          <circle cx="9" cy="-14" r="2.2" fill="#fff" opacity="0.8" />
        </g>
      );
    }

    // Default / cute / cool / shock / wow / bleh / talking
    const rx = expression === "bleh" ? 10.5 : expression === "shock" || expression === "wow" ? 14 : 13;
    const ox = expression === "wow" ? 3.5 : 0;
    const pupilRadius = expression === "bleh" ? 3.5 : 5;
    return (
      <g>
        <g style={{ transform: blinkTransform, transformOrigin: `${-rx}px -8px`, transition: "transform 110ms ease" }}>
          <circle cx={-rx} cy="-8" r={rx} fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
          <g style={{ transform: pupilTransform, transition: "transform 150ms cubic-bezier(0.22,1,0.36,1)" }}>
            <circle cx={-rx + ox} cy="-8" r={pupilRadius} fill={pupilColor} />
            <circle cx={-rx + ox - 1.8} cy="-10" r="1.7" fill="#fff" />
          </g>
        </g>
        <g style={{ transform: blinkTransform, transformOrigin: `${rx}px -8px`, transition: "transform 110ms ease" }}>
          <circle cx={rx} cy="-8" r={rx} fill={eyeWhite} stroke={stroke} strokeWidth="2.4" />
          <g style={{ transform: pupilTransform, transition: "transform 150ms cubic-bezier(0.22,1,0.36,1)" }}>
            <circle cx={rx + ox} cy="-8" r={pupilRadius} fill={pupilColor} />
            <circle cx={rx + ox - 1.8} cy="-10" r="1.7" fill="#fff" />
          </g>
        </g>
      </g>
    );
  };

  const renderTriThirdEye = () => {
    if (eyeMode !== "tri") return null;
    if (expression === "sleep") {
      return <path d="M -8 -29 Q 0 -24 8 -29" fill="none" stroke={stroke} strokeWidth="2.8" strokeLinecap="round" />;
    }
    return (
      <g style={{ transform: blinkTransform, transformOrigin: "0px -30px" }}>
        <circle cx="0" cy="-30" r="8.5" fill={eyeWhite} stroke={stroke} strokeWidth="2.2" />
        <g style={{ transform: pupilTransform }}>
          <circle cx="0" cy="-30" r="3.4" fill={pupilColor} />
          <circle cx="-1.2" cy="-31.5" r="1.1" fill="#fff" />
        </g>
      </g>
    );
  };

  const renderMouth = () => {
    if (isRobot && expression === "talking") {
      const heights =
        effPhase === 0
          ? [6, 12, 18, 12, 6]
          : effPhase === 1
            ? [12, 18, 8, 16, 10]
            : effPhase === 2
              ? [16, 10, 20, 12, 16]
              : [8, 16, 12, 18, 8];
      return (
        <g>
          {heights.map((h, i) => {
            const x = -18 + i * 9;
            return (
              <rect
                key={i}
                x={x - 2.6}
                y={20 - h / 2}
                width="5.2"
                height={h}
                rx="2.2"
                fill={eyeWhite}
              />
            );
          })}
        </g>
      );
    }

    if (expression === "talking") {
      if (effPhase === 0) {
        return <path d="M -13 15 Q 0 22 13 15" fill="none" stroke={stroke} strokeWidth="3.2" strokeLinecap="round" />;
      }
      if (effPhase === 2) {
        return (
          <g>
            <path
              d="M -18 10 Q 0 16 18 10 Q 16 30 0 30 Q -16 30 -18 10 Z"
              fill="#7f1d1d"
              stroke={stroke}
              strokeWidth="2.4"
            />
            <path d="M -12 12 L 12 12 L 10 16.5 L -10 16.5 Z" fill="#fff" />
            <path d="M -8 24 Q 0 19 8 24 Q 0 29 -8 24 Z" fill="#fb7185" />
          </g>
        );
      }
      if (effPhase === 3) {
        return (
          <g>
            <ellipse cx="0" cy="19" rx="7" ry="9" fill="#7f1d1d" stroke={stroke} strokeWidth="2.4" />
            <ellipse cx="0" cy="24" rx="4" ry="2.5" fill="#fb7185" />
          </g>
        );
      }
      return (
        <g>
          <path
            d="M -16 12 Q 0 17 16 12 Q 13 24 0 24 Q -13 24 -16 12 Z"
            fill="#7f1d1d"
            stroke={stroke}
            strokeWidth="2.4"
          />
          <path d="M -10 13.5 L 10 13.5 L 8 17 L -8 17 Z" fill="#fff" />
        </g>
      );
    }

    if (expression === "wink") {
      return (
        <g>
          <path
            d="M -15 16 Q 2 22 18 8 Q 16 28 -2 27 Q -13 27 -15 16 Z"
            fill="#7f1d1d"
            stroke={stroke}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path d="M -7 23 Q 3 19 10 22 Q 2 28 -7 23 Z" fill="#fb7185" />
          <path d="M 15 5 Q 20 8 18 13" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
        </g>
      );
    }

    if (expression === "cheeky") {
      return (
        <g>
          <path
            d="M -18 11 Q 0 16 18 11 Q 15 24 0 24 Q -15 24 -18 11 Z"
            fill="#7f1d1d"
            stroke={stroke}
            strokeWidth="2.4"
          />
          <path
            d="M 4 15 Q -10 21 -14 34 Q -8 39 1 32 Q 11 23 11 16 Z"
            fill="#fb7185"
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </g>
      );
    }

    if (expression === "bored") {
      return (
        <g>
          <path d="M -16 24 Q 0 15 16 24" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
          <line x1="-18" y1="22" x2="-15" y2="26" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
          <line x1="18" y1="22" x2="15" y2="26" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
        </g>
      );
    }

    if (expression === "cash") {
      return (
        <g>
          <path
            d="M -16 10 L 16 10 Q 17 34 0 34 Q -17 34 -16 10 Z"
            fill="#7f1d1d"
            stroke={stroke}
            strokeWidth="2.5"
          />
          <path d="M -10 26 Q 0 20 10 26 Q 0 34 -10 26 Z" fill="#fb7185" />
        </g>
      );
    }

    if (expression === "fierce") {
      return (
        <g>
          <path
            d="M -23 23 L -15 12 L 15 12 L 23 25 Q 0 19 -23 23 Z"
            fill="#fff"
            stroke={stroke}
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <line x1="-18" y1="18" x2="18" y2="18" stroke={stroke} strokeWidth="2" />
          <line x1="-9" y1="12" x2="-10" y2="21" stroke={stroke} strokeWidth="1.8" />
          <line x1="0" y1="12" x2="0" y2="20" stroke={stroke} strokeWidth="1.8" />
          <line x1="9" y1="12" x2="10" y2="21" stroke={stroke} strokeWidth="1.8" />
        </g>
      );
    }

    if (expression === "cute") {
      return (
        <g>
          <path d="M -16 16 Q 0 27 16 16" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
          <path d="M -18 14 Q -16 18 -13 19" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
          <path d="M 18 14 Q 16 18 13 19" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    }

    if (expression === "sleep" || expression === "wow") {
      return <ellipse cx="0" cy="20" rx="5.5" ry="9.5" fill="#991b1b" stroke={stroke} strokeWidth="2.5" />;
    }

    if (expression === "sweet" || expression === "cool") {
      return (
        <g>
          <path
            d="M -19 13 Q 0 19 19 13 Q 15 30 0 30 Q -15 30 -19 13 Z"
            fill="#7f1d1d"
            stroke={stroke}
            strokeWidth="2.5"
          />
          <path d="M -13 14.5 Q 0 18 13 14.5 L 11 18.5 L -11 18.5 Z" fill="#fff" />
          <path d="M -9 24 Q 0 20 9 24 Q 0 30 -9 24 Z" fill="#fb7185" />
        </g>
      );
    }

    if (expression === "bleh") {
      return (
        <g>
          <path
            d="M -19 14 L 19 17 L 17 24 Q 0 21 -17 22 Z"
            fill="#7f1d1d"
            stroke={stroke}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path d="M -16 14.5 L -2 15.5 L -4 20 L -15 19.5 Z" fill="#fff" />
          <path d="M 0 16 Q 13 17 15 32 Q 12 39 5 35 Q 0 29 0 16 Z" fill="#fb7185" stroke={stroke} strokeWidth="2.2" />
        </g>
      );
    }

    if (expression === "smug") {
      return (
        <g>
          <path
            d="M -23 13 Q 0 22 23 11 Q 18 29 0 29 Q -18 29 -23 13 Z"
            fill="#fff"
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path d="M -19 21 Q 0 25 19 19" fill="none" stroke={stroke} strokeWidth="1.8" />
          <line x1="-10" y1="16" x2="-10" y2="27" stroke={stroke} strokeWidth="1.6" />
          <line x1="0" y1="17" x2="0" y2="29" stroke={stroke} strokeWidth="1.6" />
          <line x1="10" y1="16" x2="10" y2="27" stroke={stroke} strokeWidth="1.6" />
        </g>
      );
    }

    if (expression === "dizzy") {
      return (
        <path
          d="M -19 22 Q -10 13 -3 21 Q 4 27 11 19 Q 16 14 20 22"
          fill="none"
          stroke={stroke}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      );
    }

    if (expression === "shock") {
      return (
        <path
          d="M -20 15 Q -12 10 -4 15 Q 4 10 12 15 Q 20 12 22 21 Q 16 29 6 24 Q -2 29 -10 24 Q -22 28 -20 15 Z"
          fill="#b91c1c"
          stroke={stroke}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
      );
    }

    if (expression === "cry") {
      return (
        <g>
          <path
            d="M -18 26 Q -14 10 0 10 Q 14 10 18 26 Q 0 22 -18 26 Z"
            fill="#7f1d1d"
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path d="M -9 24 Q 0 18 9 24 Q 0 27 -9 24 Z" fill="#fb7185" />
        </g>
      );
    }

    // love
    return (
      <g>
        <path
          d="M -16 14 Q 10 10 18 3 Q 15 24 0 24 Q -13 24 -16 14 Z"
          fill="#7f1d1d"
          stroke={stroke}
          strokeWidth="2.4"
        />
        <path
          d="M -4 19 Q 9 13 11 26 Q 6 39 -7 38 Q -13 33 -4 19 Z"
          fill="#fb7185"
          stroke={stroke}
          strokeWidth="2.2"
        />
      </g>
    );
  };

  return (
    <g data-layer="avatar-face-rig" transform={`translate(${cx},${cy}) scale(${scale})`}>
      {renderBrows()}
      {eyeMode === "cyclops" ? renderCyclopsEye() : renderDuoEyes()}
      {renderTriThirdEye()}
      {renderMouth()}
    </g>
  );
};

