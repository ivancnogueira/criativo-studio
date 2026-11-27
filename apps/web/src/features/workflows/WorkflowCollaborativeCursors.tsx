import type { WorkflowPresenceMember } from "@criativo/contracts";

const COLLABORATOR_PALETTE = [
  "#007CF7",
  "#31CF76",
  "#FF9412",
  "#E879F9",
  "#22D3EE",
  "#F43F5E",
  "#A3E635",
  "#FACC15",
] as const;

/**
 * Resolve uma cor determinística de alto contraste para o colaborador a partir do `memberId`.
 */
export function resolveCollaboratorColor(memberId: string): string {
  let hash = 0;
  for (let i = 0; i < memberId.length; i += 1) {
    hash = (hash * 31 + memberId.charCodeAt(i)) >>> 0;
  }
  return COLLABORATOR_PALETTE[hash % COLLABORATOR_PALETTE.length];
}

/**
 * Camada de cursores colaborativos ao vivo renderizada sobre o mundo transformado do grafo.
 */
export function WorkflowCollaborativeCursors({
  members,
}: {
  members: WorkflowPresenceMember[];
}) {
  const visibleCursors = members.filter(
    (member) =>
      typeof member.cursorX === "number" &&
      Number.isFinite(member.cursorX) &&
      typeof member.cursorY === "number" &&
      Number.isFinite(member.cursorY)
  );

  if (visibleCursors.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="workflow-collaborative-cursors"
      className="pointer-events-none absolute inset-0 z-30 overflow-visible"
    >
      {visibleCursors.map((member) => {
        const color = resolveCollaboratorColor(member.memberId);
        const x = member.cursorX ?? 0;
        const y = member.cursorY ?? 0;
        return (
          <div
            key={member.memberId}
            data-testid={`workflow-cursor-${member.memberId}`}
            style={{
              transform: `translate3d(${x}px, ${y}px, 0)`,
              transition: "transform 90ms linear",
            }}
            className="absolute left-0 top-0 will-change-transform"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="-translate-x-0.5 -translate-y-0.5 drop-shadow-[0_2px_6px_rgba(0,0,0,0.65)]"
            >
              <path
                d="M3 2.5L16.5 9.2L10.4 11.1L8.1 17L3 2.5Z"
                fill={color}
                stroke="#111111"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            <span
              style={{ backgroundColor: color }}
              className="ml-3 -mt-1 inline-flex max-w-[140px] items-center truncate rounded-full px-2 py-0.5 text-[11px] font-semibold text-[#111111] shadow-lg"
            >
              {member.displayName}
            </span>
          </div>
        );
      })}
    </div>
  );
}
