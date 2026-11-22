import type { PasswordManagerDriverStatus } from "@criativo/contracts";
import { normalizeLoginDomain } from "../login-vault-service.ts";
import {
  defaultCliExecutor,
  type CliExecutor,
  type ExternalPasswordMatch,
  type ExternalPasswordSecret,
  type PasswordManagerDriver,
} from "./driver-types.ts";

interface ProtonPassItem {
  item_id?: string;
  id?: string;
  title?: string;
  urls?: string[];
  username?: string;
  password?: string;
  totp?: string;
}

export class ProtonPassDriver implements PasswordManagerDriver {
  public readonly id = "protonpass" as const;
  public readonly label = "Proton Pass CLI";
  public readonly cliBinary = "pass-cli";
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
        detail: "Binário `pass-cli` não encontrado no PATH.",
      };
    }

    const info = await this.execCli(this.cliBinary, ["info"]);
    const authenticated = info.exitCode === 0;
    return {
      id: this.id,
      label: this.label,
      cliBinary: this.cliBinary,
      installed: true,
      authenticated,
      detail: authenticated
        ? `Autenticado (${ver.stdout.trim()}).`
        : "Proton Pass CLI instalado, aguardando login (`pass-cli login`).",
    };
  }

  public async findMatching(domain: string): Promise<ExternalPasswordMatch[]> {
    const target = normalizeLoginDomain(domain);
    const res = await this.execCli(this.cliBinary, ["item", "list", "--output", "json"]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return [];
    try {
      const items = JSON.parse(res.stdout) as ProtonPassItem[];
      return items
        .filter((it) =>
          (it.urls ?? []).some((u) => {
            const host = normalizeLoginDomain(u);
            return host === target || host.endsWith(`.${target}`);
          }),
        )
        .map((it) => ({
          externalId: it.item_id ?? it.id ?? "",
          title: it.title || target,
          domain: target,
          username: it.username ?? "",
        }))
        .filter((m) => m.externalId.length > 0);
    } catch {
      return [];
    }
  }

  public async revealSecret(externalId: string): Promise<ExternalPasswordSecret | null> {
    const res = await this.execCli(this.cliBinary, [
      "item",
      "view",
      externalId,
      "--output",
      "json",
    ]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return null;
    try {
      const item = JSON.parse(res.stdout) as ProtonPassItem;
      if (!item.password) return null;
      return {
        username: item.username ?? "",
        password: item.password,
        ...(item.totp ? { totpSecret: item.totp } : {}),
      };
    } catch {
      return null;
    }
  }
}
