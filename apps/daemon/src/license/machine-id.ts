import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";

export interface MachineFingerprint {
  machineId: string;
  hostname: string;
  osPlatform: string;
  source: string;
}

function hashMachineSeed(rawSeed: string): string {
  return createHash("sha256")
    .update(`criativo-machine-v1:${rawSeed.trim()}`)
    .digest("hex");
}

function firstNonInternalMac(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets).sort()) {
    const entries = nets[name] ?? [];
    for (const item of entries) {
      if (!item.internal && item.mac && item.mac !== "00:00:00:00:00:00") {
        return item.mac;
      }
    }
  }
  return "no-mac";
}

function tryReadNativeMachineGuid(): { raw: string; source: string } | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { encoding: "utf8", timeout: 2000, windowsHide: true },
      );
      const match = /MachineGuid\s+REG_SZ\s+([^\r\n]+)/i.exec(out);
      if (match?.[1]?.trim()) {
        return { raw: `win:${match[1].trim()}`, source: "windows_machine_guid" };
      }
    } else if (process.platform === "linux") {
      for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        if (existsSync(path)) {
          const content = readFileSync(path, "utf8").trim();
          if (content) return { raw: `linux:${content}`, source: path };
        }
      }
    } else if (process.platform === "darwin") {
      const out = execFileSync(
        "ioreg",
        ["-rd1", "-c", "IOPlatformExpertDevice"],
        { encoding: "utf8", timeout: 2000 },
      );
      const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out);
      if (match?.[1]?.trim()) {
        return { raw: `mac:${match[1].trim()}`, source: "macos_platform_uuid" };
      }
    }
  } catch {
    // Segue para fallback determinístico sem quebrar o boot
  }
  return null;
}

/**
 * Gera impressão digital SHA-256 determinística e anônima da máquina atual.
 * Nunca envia identificadores brutos de hardware na rede.
 */
export function resolveMachineFingerprint(overrideSeed?: string): MachineFingerprint {
  const hostname = os.hostname() || "criativo-host";
  const osPlatform = `${os.platform()}-${os.arch()}`;

  const testOverride = overrideSeed ?? process.env.CRIATIVO_TEST_MACHINE_ID;
  if (testOverride && testOverride.trim().length > 0) {
    return {
      machineId: hashMachineSeed(`override:${testOverride.trim()}`),
      hostname,
      osPlatform,
      source: "override",
    };
  }

  const nativeId = tryReadNativeMachineGuid();
  if (nativeId) {
    return {
      machineId: hashMachineSeed(nativeId.raw),
      hostname,
      osPlatform,
      source: nativeId.source,
    };
  }

  const fallbackRaw = `${hostname}|${osPlatform}|${firstNonInternalMac()}`;
  return {
    machineId: hashMachineSeed(fallbackRaw),
    hostname,
    osPlatform,
    source: "fallback_network_host",
  };
}
