import { execFile } from "node:child_process";
import type { PasswordManagerDriverStatus } from "@criativo/contracts";

export interface CliExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CliExecutor = (
  binary: string,
  args: string[],
  timeoutMs?: number,
) => Promise<CliExecResult>;

export interface ExternalPasswordMatch {
  externalId: string;
  title: string;
  domain: string;
  username: string;
}

export interface ExternalPasswordSecret {
  username: string;
  password: string;
  totpSecret?: string;
}

export interface PasswordManagerDriver {
  readonly id: "1password" | "bitwarden" | "protonpass";
  readonly label: string;
  readonly cliBinary: string;
  checkStatus(): Promise<PasswordManagerDriverStatus>;
  findMatching(domain: string): Promise<ExternalPasswordMatch[]>;
  revealSecret(externalId: string): Promise<ExternalPasswordSecret | null>;
}

/**
 * Executa um binário CLI externo de forma segura via `execFile` (sem invocação de shell).
 */
export const defaultCliExecutor: CliExecutor = (
  binary: string,
  args: string[],
  timeoutMs = 5000,
): Promise<CliExecResult> =>
  new Promise((resolve) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
          return;
        }
        const errObj = error as NodeJS.ErrnoException & { code?: number | string };
        const exitCode = typeof errObj.code === "number" ? errObj.code : 1;
        resolve({
          exitCode,
          stdout: String(stdout ?? ""),
          stderr: errObj.code === "ENOENT" ? "ENOENT" : String(stderr || error.message),
        });
      },
    );
  });
