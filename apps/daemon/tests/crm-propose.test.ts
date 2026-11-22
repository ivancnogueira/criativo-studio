import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CriativoDatabase } from "../src/database/client.ts";
import { CrmService } from "../src/crm/crm-service.ts";
import { executeCrmTool } from "../src/crm/crm-tools.ts";

test("crm_propose não altera crm_contacts sem aprovação humana e aplica diff após decideProposal(approved=true)", () => {
  const dir = mkdtempSync(join(tmpdir(), "criativo-crm-"));
  const db = new CriativoDatabase({ dbPath: join(dir, "studio.db") });
  db.initializeDatabase();

  try {
    const crm = new CrmService(db);

    // Desativado por padrão
    assert.equal(crm.isEnabled(), false);
    const blockedRes = executeCrmTool(
      "crm_propose",
      { operation: "create_contact", summary: "Lead", diff: { name: "Lead" } },
      { agenteId: "estrategista" },
      crm,
    ) as { ok: boolean };
    assert.equal(blockedRes.ok, false);

    // Ativa CRM opcional
    crm.setEnabled(true);
    const propRes = executeCrmTool(
      "crm_propose",
      {
        operation: "create_contact",
        summary: "Cadastrar lead vindo do Telegram",
        diff: {
          name: "Empresa Exemplo Ltda",
          email: "contato@empresa.exemplo",
          stage: "qualificado",
          tags: ["inbound", "telegram"],
        },
      },
      { agenteId: "estrategista" },
      crm,
    ) as { ok: boolean; requiresApproval: boolean; proposal: { proposalId: string } };

    assert.equal(propRes.ok, true);
    assert.equal(propRes.requiresApproval, true);
    // Ainda NÃO inserido em crm_contacts antes da aprovação humana
    assert.equal(crm.listContacts().length, 0);

    // Aprovação humana com pequeno ajuste no diff
    const decided = crm.decideProposal({
      proposalId: propRes.proposal.proposalId,
      approved: true,
      decidedBy: "operador",
    });
    assert.equal(decided.proposal.status, "approved");
    assert.equal(crm.listContacts().length, 1);
    assert.equal(crm.listContacts()[0]!.name, "Empresa Exemplo Ltda");
    assert.equal(crm.listContacts()[0]!.stage, "qualificado");

    // Propor mudança de estágio + rejeitar mantém estágio anterior intacto
    const propStage = crm.proposeMutation({
      agenteId: "estrategista",
      operation: "move_stage",
      contactId: decided.appliedContact!.contactId,
      summary: "Mover para ganho",
      diff: { stage: "ganho" },
    });
    crm.decideProposal({ proposalId: propStage.proposalId, approved: false });
    assert.equal(crm.listContacts()[0]!.stage, "qualificado");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
