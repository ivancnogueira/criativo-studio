import type { PasswordManagerDriverStatus } from "@criativo/contracts";
import { normalizeLoginDomain } from "../login-vault-service.ts";
import {
  defaultCliExecutor,
  type CliExecutor,
  type ExternalPasswordMatch,
  type ExternalPasswordSecret,
  type PasswordManagerDriver,
} from "./driver-types.ts";

interface OpItemSummary {
  id: string;
  title?: string;
  urls?: Array<{ href?: string }>;
}

interface OpItemDetail {
  id: string;
  fields?: Array<{ id?: string; label?: string; type?: string; purpose?: string; value?: string }>;
}

export class OnePasswordDriver implements PasswordManagerDriver {
  public readonly id = "1password" as const;
  public readonly label = "1Password CLI";
  public readonly cliBinary = "op";
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
        detail: "Binário `op` não encontrado no PATH.",
      };
    }

    const who = await this.execCli(this.cliBinary, ["whoami", "--format=json"]);
    if (who.exitCode !== 0) {
      return {
        id: this.id,
        label: this.label,
        cliBinary: this.cliBinary,
        installed: true,
        authenticated: false,
        detail: "1Password CLI instalado, aguardando sessão autenticada (`op signin`).",
      };
    }

    return {
      id: this.id,
      label: this.label,
      cliBinary: this.cliBinary,
      installed: true,
      authenticated: true,
      detail: `Autenticado (op ${ver.stdout.trim()}).`,
    };
  }

  public async findMatching(domain: string): Promise<ExternalPasswordMatch[]> {
    const res = await this.execCli(this.cliBinary, [
      "item",
      "list",
      "--categories",
      "Login",
      "--format=json",
    ]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return [];
    try {
      const items = JSON.parse(res.stdout) as OpItemSummary[];
      const target = normalizeLoginDomain(domain);
      return items
        .filter((it) =>
          (it.urls ?? []).some((u) => {
            const host = normalizeLoginDomain(u.href ?? "");
            return host === target || host.endsWith(`.${target}`);
          }),
        )
        .map((it) => ({
          externalId: it.id,
          title: it.title || target,
          domain: target,
          username: "",
        }));
    } catch {
      return [];
    }
  }

  public async revealSecret(externalId: string): Promise<ExternalPasswordSecret | null> {
    const res = await this.execCli(this.cliBinary, ["item", "get", externalId, "--format=json"]);
    if (res.exitCode !== 0 || !res.stdout.trim()) return null;
    try {
      const detail = JSON.parse(res.stdout) as OpItemDetail;
      const fields = detail.fields ?? [];
      const userField = fields.find(
        (f) => f.purpose === "USERNAME" || f.id === "username" || f.label === "username",
      );
      const passField = fields.find(
        (f) => f.purpose === "PASSWORD" || f.id === "password" || f.type === "CONCEALED",
      );
      if (!passField?.value) return null;
      return {
        username: userField?.value ?? "",
        password: passField.value,
      };
    } catch {
      return null;
    }
  }
}
