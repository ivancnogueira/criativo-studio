import { spawn } from "node:child_process";

export interface NativeUpdateRelaunchParams {
  platform: NodeJS.Platform;
  currentPid: number;
  currentExePath: string;
  artifactPath: string;
  version?: string | null;
  appImagePath?: string | null;
  openPathFallback?: (path: string) => void;
}

/**
 * Gera o script PowerShell (lendo apenas variáveis de ambiente CRIATIVO_UPDATER_*)
 * que aguarda o fechamento do processo atual do Electron, exibe um pequeno aviso visual
 * "Atualizando CriativoOS...", executa o instalador NSIS em /S e reabre o app.
 */
export function buildWindowsUpdateRelaunchScript(): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$targetPid = 0",
    "[int]::TryParse($env:CRIATIVO_UPDATER_PID, [ref]$targetPid) | Out-Null",
    "$installer = $env:CRIATIVO_UPDATER_INSTALLER",
    "$exePath = $env:CRIATIVO_UPDATER_EXE",
    "$ver = $env:CRIATIVO_UPDATER_VERSION",
    "$deadline = (Get-Date).AddSeconds(25)",
    "while ($targetPid -gt 0 -and (Get-Date) -lt $deadline) {",
    "  if (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) { break }",
    "  Start-Sleep -Milliseconds 250",
    "}",
    "Start-Sleep -Milliseconds 450",
    "$splashForm = $null",
    "try {",
    "  Add-Type -AssemblyName System.Windows.Forms",
    "  Add-Type -AssemblyName System.Drawing",
    "  $splashForm = New-Object System.Windows.Forms.Form",
    "  $splashForm.FormBorderStyle = 'None'",
    "  $splashForm.StartPosition = 'CenterScreen'",
    "  $splashForm.Size = New-Object System.Drawing.Size(360, 118)",
    "  $splashForm.BackColor = [System.Drawing.Color]::FromArgb(20, 26, 22)",
    "  $splashForm.TopMost = $true",
    "  $splashForm.ShowInTaskbar = $false",
    "  $titleLbl = New-Object System.Windows.Forms.Label",
    "  $titleLbl.AutoSize = $false",
    "  $titleLbl.Dock = 'Fill'",
    "  $titleLbl.TextAlign = 'MiddleCenter'",
    "  $titleLbl.ForeColor = [System.Drawing.Color]::FromArgb(240, 240, 240)",
    "  $titleLbl.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)",
    "  $verText = if ($ver) { ' v' + $ver } else { '' }",
    "  $titleLbl.Text = 'Atualizando CriativoOS' + $verText + \"`n\" + 'Instalando e reiniciando automaticamente...'",
    "  $splashForm.Controls.Add($titleLbl)",
    "  $splashForm.Show()",
    "  [System.Windows.Forms.Application]::DoEvents()",
    "} catch { $splashForm = $null }",
    "if ($installer -and (Test-Path -LiteralPath $installer)) {",
    "  $proc = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -WindowStyle Hidden",
    "  if ($proc) {",
    "    while (-not $proc.HasExited) {",
    "      if ($splashForm) { try { [System.Windows.Forms.Application]::DoEvents() } catch {} }",
    "      Start-Sleep -Milliseconds 120",
    "    }",
    "  }",
    "}",
    "if ($splashForm) { try { $splashForm.Close(); $splashForm.Dispose() } catch {} }",
    "if ($exePath -and (Test-Path -LiteralPath $exePath)) {",
    "  Start-Process -FilePath $exePath",
    "}",
  ].join("; ");
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
    const helper = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
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
