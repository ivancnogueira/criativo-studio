import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { VaultService } from "../src/vault/vault-service.ts";
import { LoginVaultService } from "../src/vault/login-vault-service.ts";
import { importCsvLogins } from "../src/vault/csv-login-importer.ts";
import { PasswordManagerRegistry } from "../src/vault/password-managers/registry.ts";
import type { CliExecutor } from "../src/vault/password-managers/driver-types.ts";

function withTempVault(
  fn: (db: CriativoDatabase, loginVault: LoginVaultService) => Promise<void> | void,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "criativo-loginvault-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();
  const vault = new VaultService(db, "chave-mestra-cofre-logins");
  const loginVault = new LoginVaultService(db, vault);
  return Promise.resolve(fn(db, loginVault)).finally(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
}

test("LoginVaultService criptografa senhas, omite segredos nas listagens e respeita políticas exact/anywhere/never", async () => {
  await withTempVault((db, loginVault) => {
    const created = loginVault.createLogin({
      title: "Painel Exemplo",
      domain: "https://www.Painel.Exemplo.com/login",
      username: "operador@exemplo.com",
      password: "SegredoSuperForte!123",
      totpSecret: "JBSWY3DPEHPK3PXP",
      autofillPolicy: "exact",
    });

    assert.equal(created.domain, "painel.exemplo.com");
    assert.equal("password" in created, false);
    assert.equal(created.hasTotp, true);

    const rawRow = db.connection
      .prepare("SELECT password_encrypted FROM cofre_logins WHERE login_id = ?;")
      .get(created.id) as { password_encrypted: string };
    assert.ok(!rawRow.password_encrypted.includes("SegredoSuperForte"));

    // exact permite subdomínio do domínio cadastrado e bloqueia outro host
    assert.equal(loginVault.findMatchingForUrl("https://app.painel.exemplo.com/admin").length, 1);
    assert.equal(loginVault.findMatchingForUrl("https://outro-site.com").length, 0);

    // política never bloqueia revealForAuthorizedAutofill
    loginVault.updateLogin(created.id, { autofillPolicy: "never" });
    assert.equal(loginVault.findMatchingForUrl("https://painel.exemplo.com").length, 0);
    assert.throws(() =>
      loginVault.revealForAuthorizedAutofill(created.id, "https://painel.exemplo.com"),
    );

    // política anywhere permite em qualquer URL
    loginVault.updateLogin(created.id, { autofillPolicy: "anywhere" });
    const revealed = loginVault.revealForAuthorizedAutofill(created.id, "https://qualquer.site.dev");
    assert.equal(revealed?.password, "SegredoSuperForte!123");
    assert.equal(revealed?.totpSecret, "JBSWY3DPEHPK3PXP");

    assert.equal(loginVault.deleteLogin(created.id), true);
    assert.equal(loginVault.listLogins().length, 0);
  });
});

test("importCsvLogins executa preview com deduplicação e commit seguro", async () => {
  await withTempVault((_db, loginVault) => {
    loginVault.createLogin({
      title: "Conta Existente",
      domain: "portal.exemplo.org",
      username: "ana@exemplo.org",
      password: "SenhaAntiga",
    });

    const csv = [
      "name,url,username,password,note",
      '"Conta Existente",https://portal.exemplo.org/login,ana@exemplo.org,SenhaAntiga,"Duplicada"',
      '"Painel Novo",https://crm.exemplo.net/auth,carlos@exemplo.net,"S3nha,ComVirgula","Importada"',
      '"Painel Novo Repetido",https://crm.exemplo.net/auth,carlos@exemplo.net,"Outra","Duplicada no lote"',
    ].join("\n");

    const preview = importCsvLogins({ vault: loginVault, csvText: csv, mode: "preview" });
    assert.equal(preview.totalParsed, 3);
    assert.equal(preview.newCount, 1);
    assert.equal(preview.duplicateCount, 2);
    assert.equal(preview.importedCount, 0);
    assert.equal(loginVault.listLogins().length, 1);

    const commit = importCsvLogins({ vault: loginVault, csvText: csv, mode: "commit" });
    assert.equal(commit.importedCount, 1);
    assert.equal(loginVault.listLogins().length, 2);
    const crm = loginVault.findByDomainAndUsername("crm.exemplo.net", "carlos@exemplo.net");
    assert.ok(crm);
    const revealed = loginVault.revealForAuthorizedAutofill(crm!.id, "https://crm.exemplo.net");
    assert.equal(revealed?.password, "S3nha,ComVirgula");
  });
});

test("PasswordManagerRegistry detecta CLIs simulados e consulta segredos sem shell", async () => {
  const mockExec: CliExecutor = async (binary, args) => {
    if (binary === "op") {
      if (args[0] === "--version") return { exitCode: 0, stdout: "2.30.0", stderr: "" };
      if (args[0] === "whoami") return { exitCode: 0, stdout: '{"email":"op@teste.local"}', stderr: "" };
      if (args[0] === "item" && args[1] === "list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { id: "op-1", title: "Painel Externo", urls: [{ href: "https://externo.exemplo.com" }] },
          ]),
          stderr: "",
        };
      }
      if (args[0] === "item" && args[1] === "get") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            id: "op-1",
            fields: [
              { id: "username", value: "user_op" },
              { id: "password", type: "CONCEALED", value: "PassOp999" },
            ],
          }),
          stderr: "",
        };
      }
    }
    if (binary === "bw") {
      if (args[0] === "--version") return { exitCode: 0, stdout: "2024.9.0", stderr: "" };
      if (args[0] === "status") return { exitCode: 0, stdout: '{"status":"locked"}', stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "ENOENT" };
  };

  const registry = new PasswordManagerRegistry(mockExec);
  const statuses = await registry.getStatuses();
  assert.equal(statuses.length, 3);
  assert.equal(statuses.find((s) => s.id === "1password")?.authenticated, true);
  assert.equal(statuses.find((s) => s.id === "bitwarden")?.installed, true);
  assert.equal(statuses.find((s) => s.id === "bitwarden")?.authenticated, false);
  assert.equal(statuses.find((s) => s.id === "protonpass")?.installed, false);

  const matches = await registry.findExternalMatchesForDomain("externo.exemplo.com");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.id, "1password:op-1");

  const secret = await registry.revealExternalSecret("1password:op-1");
  assert.equal(secret?.username, "user_op");
  assert.equal(secret?.password, "PassOp999");
});
