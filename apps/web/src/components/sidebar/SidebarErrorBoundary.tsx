import React from "react";

interface SidebarErrorBoundaryProps {
  fallbackLabel?: string;
  children: React.ReactNode;
}

interface SidebarErrorBoundaryState {
  hasError: boolean;
}

/**
 * Isola falhas pontuais de renderização em um canal/seção sem derrubar a sidebar inteira.
 */
export class SidebarErrorBoundary extends React.Component<
  SidebarErrorBoundaryProps,
  SidebarErrorBoundaryState
> {
  public state: SidebarErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): SidebarErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: unknown): void {
    console.warn("[SidebarErrorBoundary] Item isolado após erro de renderização:", error);
  }

  public render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="status"
          className="px-2.5 py-2 rounded-xl border border-[#FD2F3B]/25 bg-[#FD2F3B]/10 text-[11.5px] text-[#FF9B9F]"
        >
          {this.props.fallbackLabel || "Canal indisponível"}
        </div>
      );
    }
    return this.props.children;
  }
}
