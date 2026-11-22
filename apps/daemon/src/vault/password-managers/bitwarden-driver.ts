import type { PasswordManagerDriverStatus } from "@criativo/contracts";
import { normalizeLoginDomain } from "../login-vault-service.ts";
import {
  defaultCliExecutor,
  type CliExecutor,
  type ExternalPasswordMatch,
  type ExternalPasswordSecret,
  type PasswordManagerDriver,
} from "./driver-types.ts";

interface BwItem {
  id: string;
  name?: string;
  login?: {
    username?: string;
    password?: string;
    totp?: string;
    uris?: Array<{ uri?: string }>;
  };
}

export class BitwardenDriver implements PasswordManagerDriver {
  public readonly id = "bitwarden" as const;
  public readonly label = "Bitwarden CLI";
  public readonly cliBinary = "bw";
  private readonly execCli: CliExecutor;

  constructor(execCli: CliExecutor = defaultCliExecutor) {
    this.execCli = execCli;
  }

  public async checkStatus(): Promise<PasswordManagerDriverStatus> {
    const ver = await this.execCli(this.cliBinary, ["--version"]);
    if (ver.stderr === "ENOENT" || ver.exitCode !== 0) {
      return {
        id: this.id,
        label: this.label,
        cliBinary: this.cliBinary,
        installed: false,
        authenticated: false,
        detail: "Binário `bw` não encontrado no PATH.",
      };
    }

    const statusRes = await this.execCli(this.cliBinary, ["status"]);
    let parsedStatus = "";
    try {
      const parsed = JSON.parse(statusRes.stdout || "{}") as { status?: string };
      parsedStatus = parsed.status ?? "";
    } catch {
      parsedStatus = "";
    }

    const unlocked = parsedStatus === "unlocked";
    return {
      id: this.id,
      label: this.label,
      cliBinary: this.cliBinary,
      installed: true,
      authenticated: unlocked,
      detail: unlocked
        ? `Cofre Bitwarden desbloqueado (bw ${ver.stdout.trim()}).`
        : `Bitwarden CLI instalado (${parsedStatus || "locked"}). Execute bw unlock.`,
    };
  }

  public async findMatching(domain: string): Promise<ExternalPasswordMatch[]> {
    const target = normalizeLoginDomain(domain);
    const res = await this.execCli(this.cliBinary, ["list", "items", "--url", target]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return [];
    try {
      const items = JSON.parse(res.stdout) as BwItem[];
      return items
        .filter((it) => Boolean(it.login?.username))
        .map((it) => ({
          externalId: it.id,
          title: it.name || target,
          domain: target,
          username: it.login?.username ?? "",
        }));
    } catch {
      return [];
    }
  }

  public async revealSecret(externalId: string): Promise<ExternalPasswordSecret | null> {
    const res = await this.execCli(this.cliBinary, ["get", "item", externalId]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return null;
    try {
      const item = JSON.parse(res.stdout) as BwItem;
      if (!item.login?.password) return null;
      return {
        username: item.login.username ?? "",
        password: item.login.password,
        ...(item.login.totp ? { totpSecret: item.login.totp } : {}),
      };
    } catch {
      return null;
    }
  }
}
