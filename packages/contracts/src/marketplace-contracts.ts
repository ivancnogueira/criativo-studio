/**
 * Contratos compartilhados da Loja Unificada (Apps, Agentes e Habilidades),
 * importação GitHub e controle de acesso/instalação.
 */

import type { AvatarShape } from "./index.ts";
import type { McpServidorConfig, McpTransporte } from "./mcp-contracts.ts";

export type MarketplaceTab = "apps" | "agents" | "skills";

export type MarketplaceSourceFilter = "all" | "verified" | "public";

export type MarketplaceAuthKind = "oauth" | "key" | "local";

export interface MarketplaceAuthField {
  key: string;
  label: string;
  target: "header" | "env" | "query";
  prefix?: string;
  secret: boolean;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

export interface MarketplaceAuthFlow {
  id: string;
  kind: MarketplaceAuthKind;
  label: string;
  description?: string;
  helpUrl?: string;
  docsLabel?: string;
  fields?: MarketplaceAuthField[];
  localInstructions?: string[];
  note?: string;
  defaultUrl?: string;
}

export interface MarketplaceAppPrompt {
  id: string;
  title?: string;
  text: string;
}

export interface MarketplaceServerTemplate {
  name: string;
  transport: McpTransporte;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  earlierUrls?: string[];
}

export interface MarketplaceAppItem {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  creatorName: string;
  verified: boolean;
  featured: boolean;
  iconKey: string;
  isNative: boolean;
  prompts: MarketplaceAppPrompt[];
  authFlows: MarketplaceAuthFlow[];
  serverTemplate: MarketplaceServerTemplate | null;
  websiteUrl?: string;
  docsUrl?: string;
}

export interface MarketplaceAgentRoutineTemplate {
  name: string;
  instruction: string;
  active: boolean;
  schedule: {
    kind: string;
    time?: string;
    weekday?: number;
    day?: number;
    cron?: string;
  };
}

export interface MarketplaceAgentPackage {
  slug: string;
  name: string;
  role: string;
  tagline: string;
  description: string;
  category: string;
  source: "verified" | "public";
  verified: boolean;
  featured: boolean;
  recommendedModel: string;
  avatarShape: AvatarShape;
  avatarColor: string;
  promptBase: string;
  skills: string[];
  routines: MarketplaceAgentRoutineTemplate[];
  mcpSlugs: string[];
}

export interface MarketplaceSkillItem {
  skillId: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  source: "nativa" | "loja" | "github" | "personalizada";
  verified: boolean;
  featured: boolean;
  installed: boolean;
  agentIds: string[];
  enabledByAgent: Record<string, boolean>;
  repositoryUrl?: string | null;
  commitSha?: string | null;
  pathOnDisk?: string | null;
  markdownPreview: string;
}

export interface GithubImportItemPreview {
  slug: string;
  name: string;
  description: string;
  path: string;
  kind: "skill" | "agent";
  markdown?: string;
  manifest?: Record<string, unknown>;
}

export interface GithubImportPreview {
  owner: string;
  repo: string;
  branch: string;
  repositoryUrl: string;
  commitSha: string;
  kind: "skills" | "agents";
  unreviewedExternalSource: boolean;
  items: GithubImportItemPreview[];
}

export interface LojaCatalogoSnapshot {
  apps: MarketplaceAppItem[];
  agents: MarketplaceAgentPackage[];
  skills: MarketplaceSkillItem[];
  installedApps: McpServidorConfig[];
  installedSkills: MarketplaceSkillItem[];
  categories: {
    apps: string[];
    agents: string[];
    skills: string[];
  };
}
