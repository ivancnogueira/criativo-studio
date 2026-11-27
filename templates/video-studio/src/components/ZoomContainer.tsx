import React from "react";

export interface ZoomContainerProps {
  isZoomed: boolean;
  children: React.ReactNode;
}

export const ZoomContainer: React.FC<ZoomContainerProps> = ({ isZoomed, children }) => {
  const scale = isZoomed ? 1.15 : 1.0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        transform: `scale(${scale})`,
        transformOrigin: "50% 35%",
        transition: "transform 0.12s ease-out",
      }}
    >
      {children}
    </div>
  );
};
