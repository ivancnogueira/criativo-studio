import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface NativeUpdateRelaunchParams {
  platform: NodeJS.Platform;
  currentPid: number;
  currentExePath: string;
  artifactPath: string;
  version?: string | null;
  appImagePath?: string | null;
  logFilePath?: string | null;
  scriptDir?: string | null;
  openPathFallback?: (path: string) => void;
}

/**
 * Gera o script PowerShell (gravado em arquivo temporário `.ps1` e alimentado via variáveis
 * CRIATIVO_UPDATER_*) que aguarda todos os processos do CriativoOS fecharem, libera travas
 * residuais de arquivo, executa o instalador NSIS em `/S /currentuser --updated` com retry/fallback
 * e reabre o app automaticamente.
 */
export function buildWindowsUpdateRelaunchScript(): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$targetPid = 0",
    "[int]::TryParse($env:CRIATIVO_UPDATER_PID, [ref]$targetPid) | Out-Null",
    "$installer = $env:CRIATIVO_UPDATER_INSTALLER",
    "$exePath = $env:CRIATIVO_UPDATER_EXE",
    "$ver = $env:CRIATIVO_UPDATER_VERSION",
    "$installDir = if ($exePath) { Split-Path -Parent $exePath } else { '' }",
    "$logPath = if ($env:CRIATIVO_UPDATER_LOG) { $env:CRIATIVO_UPDATER_LOG } elseif ($installer) { Join-Path (Split-Path -Parent $installer) 'updater.log' } else { Join-Path $env:TEMP 'criativo-updater.log' }",
    "function Write-UpdateLog([string]$msg) {",
    "  try {",
    "    $dir = Split-Path -Parent $logPath",
    "    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }",
    "    Add-Content -LiteralPath $logPath -Value (\"[\" + (Get-Date).ToString('o') + \"] \" + $msg) -Encoding UTF8",
    "  } catch {}",
    "}",
    "function Get-RunningStudioPids([string]$dirPath) {",
    "  $pids = New-Object System.Collections.Generic.List[int]",
    "  if (-not $dirPath) { return $pids }",
    "  $normDir = $dirPath.TrimEnd('\\').ToLowerInvariant()",
    "  try {",
    "    $procs = Get-CimInstance Win32_Process -Filter \"Name = 'CriativoOS.exe'\" -ErrorAction SilentlyContinue",
    "    foreach ($p in $procs) {",
    "      $ep = [string]$p.ExecutablePath",
    "      if ($ep -and $ep.ToLowerInvariant().StartsWith($normDir + '\\')) {",
    "        [void]$pids.Add([int]$p.ProcessId)",
    "      }",
    "    }",
    "  } catch {",
    "    foreach ($p in (Get-Process -Name 'CriativoOS' -ErrorAction SilentlyContinue)) {",
    "      try {",
    "        $ep = $p.Path",
    "        if ($ep -and $ep.ToLowerInvariant().StartsWith($normDir + '\\')) { [void]$pids.Add($p.Id) }",
    "      } catch {}",
    "    }",
    "  }",
    "  return $pids",
    "}",
    "Write-UpdateLog (\"Inicio updater PID=\" + $targetPid + \" ver=\" + $ver + \" installer=\" + $installer + \" exe=\" + $exePath)",
    "try {",
    "  $graceDeadline = (Get-Date).AddSeconds(12)",
    "  while ((Get-Date) -lt $graceDeadline) {",
    "    $mainAlive = ($targetPid -gt 0) -and [bool](Get-Process -Id $targetPid -ErrorAction SilentlyContinue)",
    "    $childPids = Get-RunningStudioPids $installDir",
    "    if (-not $mainAlive -and $childPids.Count -eq 0) { break }",
    "    Start-Sleep -Milliseconds 250",
    "  }",
    "  $leftover = Get-RunningStudioPids $installDir",
    "  if ($targetPid -gt 0 -and (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) -and ($leftover -notcontains $targetPid)) {",
    "    [void]$leftover.Add($targetPid)",
    "  }",
    "  if ($leftover.Count -gt 0) {",
    "    Write-UpdateLog (\"Encerrando processos residuais: \" + ($leftover -join ','))",
    "    foreach ($lid in $leftover) { Stop-Process -Id $lid -Force -ErrorAction SilentlyContinue }",
    "    Start-Sleep -Milliseconds 1500",
    "  }",
    "  $splashForm = $null",
    "  try {",
    "    Add-Type -AssemblyName System.Windows.Forms",
    "    Add-Type -AssemblyName System.Drawing",
    "    $splashForm = New-Object System.Windows.Forms.Form",
    "    $splashForm.FormBorderStyle = 'None'",
    "    $splashForm.StartPosition = 'CenterScreen'",
    "    $splashForm.Size = New-Object System.Drawing.Size(380, 126)",
    "    $splashForm.BackColor = [System.Drawing.Color]::FromArgb(20, 26, 22)",
    "    $splashForm.TopMost = $true",
    "    $splashForm.ShowInTaskbar = $false",
    "    $titleLbl = New-Object System.Windows.Forms.Label",
    "    $titleLbl.AutoSize = $false",
    "    $titleLbl.Dock = 'Fill'",
    "    $titleLbl.TextAlign = 'MiddleCenter'",
    "    $titleLbl.ForeColor = [System.Drawing.Color]::FromArgb(240, 240, 240)",
    "    $titleLbl.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)",
    "    $verText = if ($ver) { ' v' + $ver } else { '' }",
    "    $titleLbl.Text = 'Atualizando CriativoOS' + $verText + \"`n\" + 'Instalando e reiniciando automaticamente...'",
    "    $splashForm.Controls.Add($titleLbl)",
    "    $splashForm.Show()",
    "    [System.Windows.Forms.Application]::DoEvents()",
    "  } catch { $splashForm = $null }",
    "  $nsExitCode = -1",
    "  if ($installer -and (Test-Path -LiteralPath $installer)) {",
    "    for ($attempt = 1; $attempt -le 2; $attempt++) {",
    "      Write-UpdateLog (\"Executando NSIS silencioso tentativa #\" + $attempt)",
    "      $proc = Start-Process -FilePath $installer -ArgumentList @('/S', '/currentuser', '--updated') -PassThru -WindowStyle Hidden",
    "      if ($proc) {",
    "        $instDeadline = (Get-Date).AddSeconds(180)",
    "        while (-not $proc.HasExited -and (Get-Date) -lt $instDeadline) {",
    "          if ($splashForm) { try { [System.Windows.Forms.Application]::DoEvents() } catch {} }",
    "          Start-Sleep -Milliseconds 150",
    "        }",
    "        if (-not $proc.HasExited) {",
    "          Write-UpdateLog 'Timeout de 180s no NSIS silencioso'",
    "          Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue",
    "          $nsExitCode = 1460",
    "        } else {",
    "          $nsExitCode = [int]$proc.ExitCode",
    "        }",
    "      }",
    "      Write-UpdateLog (\"Resultado NSIS tentativa #\" + $attempt + \" exitCode=\" + $nsExitCode)",
    "      if ($nsExitCode -eq 0) { break }",
    "      foreach ($lid in (Get-RunningStudioPids $installDir)) { Stop-Process -Id $lid -Force -ErrorAction SilentlyContinue }",
    "      Start-Sleep -Milliseconds 2000",
    "    }",
    "    if ($splashForm) { try { $splashForm.Close(); $splashForm.Dispose() } catch {}; $splashForm = $null }",
    "    if ($nsExitCode -ne 0) {",
    "      Write-UpdateLog 'Fallback: abrindo instalador assistido visivel'",
    "      Start-Process -FilePath $installer -ArgumentList @('/currentuser', '--updated')",
    "      return",
    "    }",
    "  } else {",
    "    Write-UpdateLog 'Instalador nao encontrado no disco; abortando etapa NSIS'",
    "  }",
    "  if ($splashForm) { try { $splashForm.Close(); $splashForm.Dispose() } catch {}; $splashForm = $null }",
    "  Start-Sleep -Milliseconds 800",
    "  $alreadyUp = Get-RunningStudioPids $installDir",
    "  if ($alreadyUp.Count -eq 0 -and $exePath -and (Test-Path -LiteralPath $exePath)) {",
    "    try {",
    "      Write-UpdateLog (\"Reabrindo CriativoOS: \" + $exePath)",
    "      Start-Process -FilePath $exePath -WorkingDirectory $installDir",
    "    } catch {",
    "      Start-Sleep -Milliseconds 1500",
    "      Start-Process -FilePath $exePath -WorkingDirectory $installDir",
    "    }",
    "  } else {",
    "    Write-UpdateLog (\"Relaunch dispensado (processos ja ativos: \" + ($alreadyUp -join ',') + \")\")",
    "  }",
    "} finally {",
    "  if ($PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath)) {",
    "    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue",
    "  }",
    "}",
  ].join("\r\n");
}

/**
 * Dispara atualização nativa em segundo plano após o encerramento do processo atual e reabre o CriativoOS.
 */
export function launchNativeUpdateAndRelaunch(params: NativeUpdateRelaunchParams): {
  launched: boolean;
  strategy: "win32_powershell_relaunch" | "darwin_app_relaunch" | "linux_appimage_relaunch" | "shell_open_fallback";
} {
  const lowerArtifact = params.artifactPath.toLowerCase();

  if (params.platform === "win32" && lowerArtifact.endsWith(".exe")) {
    const script = buildWindowsUpdateRelaunchScript();
    const scriptTargetDir = params.scriptDir?.trim() || dirname(params.artifactPath);
    mkdirSync(scriptTargetDir, { recursive: true });
    const ps1Path = join(scriptTargetDir, `apply-update-${Date.now()}.ps1`);
    writeFileSync(ps1Path, `\uFEFF${script}`, "utf8");
    const helper = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ps1Path],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          CRIATIVO_UPDATER_PID: String(params.currentPid),
          CRIATIVO_UPDATER_INSTALLER: params.artifactPath,
          CRIATIVO_UPDATER_EXE: params.currentExePath,
          CRIATIVO_UPDATER_VERSION: params.version?.trim() ?? "",
          ...(params.logFilePath ? { CRIATIVO_UPDATER_LOG: params.logFilePath } : {}),
        },
      },
    );
    helper.unref();
    return { launched: true, strategy: "win32_powershell_relaunch" };
  }

  if (params.platform === "darwin" && lowerArtifact.endsWith(".zip")) {
    const appMarker = ".app/Contents/MacOS/";
    const idx = params.currentExePath.indexOf(appMarker);
    if (idx > 0) {
      const appBundlePath = params.currentExePath.slice(0, idx + 4);
      const macScript = [
        'target_pid="$CRIATIVO_UPDATER_PID"',
        'while kill -0 "$target_pid" 2>/dev/null; do sleep 0.25; done',
        'tmp_dir=$(mktemp -d)',
        'ditto -xk "$CRIATIVO_UPDATER_INSTALLER" "$tmp_dir" 2>/dev/null || unzip -q "$CRIATIVO_UPDATER_INSTALLER" -d "$tmp_dir" 2>/dev/null',
        'new_app=$(find "$tmp_dir" -maxdepth 2 -name "*.app" -type d | head -n 1)',
        'if [ -n "$new_app" ]; then rm -rf "$CRIATIVO_UPDATER_APP" && mv "$new_app" "$CRIATIVO_UPDATER_APP"; fi',
        'rm -rf "$tmp_dir"',
        'open -n "$CRIATIVO_UPDATER_APP"',
      ].join("; ");
      const helper = spawn("/bin/sh", ["-c", macScript], {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          CRIATIVO_UPDATER_PID: String(params.currentPid),
          CRIATIVO_UPDATER_INSTALLER: params.artifactPath,
          CRIATIVO_UPDATER_APP: appBundlePath,
        },
      });
      helper.unref();
      return { launched: true, strategy: "darwin_app_relaunch" };
    }
  }

  if (
    params.platform === "linux" &&
    lowerArtifact.endsWith(".appimage") &&
    params.appImagePath &&
    params.appImagePath.trim().length > 0
  ) {
    const linuxScript = [
      'target_pid="$CRIATIVO_UPDATER_PID"',
      'while kill -0 "$target_pid" 2>/dev/null; do sleep 0.25; done',
      'cp -f "$CRIATIVO_UPDATER_INSTALLER" "$CRIATIVO_UPDATER_APPIMAGE" && chmod +x "$CRIATIVO_UPDATER_APPIMAGE" && "$CRIATIVO_UPDATER_APPIMAGE" >/dev/null 2>&1 &',
    ].join("; ");
    const helper = spawn("/bin/sh", ["-c", linuxScript], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CRIATIVO_UPDATER_PID: String(params.currentPid),
        CRIATIVO_UPDATER_INSTALLER: params.artifactPath,
        CRIATIVO_UPDATER_APPIMAGE: params.appImagePath,
      },
    });
    helper.unref();
    return { launched: true, strategy: "linux_appimage_relaunch" };
  }

  params.openPathFallback?.(params.artifactPath);
  return { launched: true, strategy: "shell_open_fallback" };
}
