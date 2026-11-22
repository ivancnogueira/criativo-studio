import type {
  LoginCredentialSummary,
  PasswordManagerDriverStatus,
} from "@criativo/contracts";
import { BitwardenDriver } from "./bitwarden-driver.ts";
import {
  defaultCliExecutor,
  type CliExecutor,
  type ExternalPasswordSecret,
  type PasswordManagerDriver,
} from "./driver-types.ts";
import { OnePasswordDriver } from "./onepassword-driver.ts";
import { ProtonPassDriver } from "./protonpass-driver.ts";

export class PasswordManagerRegistry {
  private readonly drivers: PasswordManagerDriver[];

  constructor(execCli: CliExecutor = defaultCliExecutor) {
    this.drivers = [
      new OnePasswordDriver(execCli),
      new BitwardenDriver(execCli),
      new ProtonPassDriver(execCli),
    ];
  }

  public async getStatuses(): Promise<PasswordManagerDriverStatus[]> {
    return Promise.all(this.drivers.map((d) => d.checkStatus()));
  }

  public async findExternalMatchesForDomain(
    domain: string,
  ): Promise<LoginCredentialSummary[]> {
    const results: LoginCredentialSummary[] = [];
    for (const driver of this.drivers) {
      const status = await driver.checkStatus();
      if (!status.installed || !status.authenticated) continue;
      const matches = await driver.findMatching(domain);
      for (const m of matches) {
        results.push({
          id: `${driver.id}:${m.externalId}`,
          title: m.title,
          domain: m.domain,
          username: m.username,
          autofillPolicy: "exact",
          source: driver.id,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return results;
  }

  public async revealExternalSecret(
    prefixedId: string,
  ): Promise<ExternalPasswordSecret | null> {
    const idx = prefixedId.indexOf(":");
    if (idx <= 0) return null;
    const source = prefixedId.slice(0, idx);
    const externalId = prefixedId.slice(idx + 1);
    const driver = this.drivers.find((d) => d.id === source);
    if (!driver) return null;
    return driver.revealSecret(externalId);
  }
}
