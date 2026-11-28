import assert from "node:assert/strict";
import test from "node:test";
import type { AgenteEnriquecido } from "../../utils/studio-storage.ts";
import {
  applyNonNullHydration,
  computeHydrationRetryDelayMs,
} from "../studio-hydration-guard.ts";

test("EX48-03: applyNonNullHydration nunca sobrescreve estado valido em falhas transitorias", () => {
  let state: AgenteEnriquecido[] = [
    {
      agente_id: "estrategista",
      nome: "Estrategista",
      papel: "Estratégia",
      modelo_padrao: "openai/gpt-5.4",
      status: "ocioso",
      skills_paths: [],
      memoria_resumo: null,
      ordem_exibicao: 0,
      config: {},
      atualizado_em: "2026-11-28T00:00:00.000Z",
    },
  ];

  const appliedOnNull = applyNonNullHydration<AgenteEnriquecido[]>(null, (next) => {
    state = next;
  });
  assert.equal(appliedOnNull, false);
  assert.equal(state.length, 1, "Falha de rede nao deve zerar agentes existentes");

  const appliedOnUndefined = applyNonNullHydration<AgenteEnriquecido[]>(undefined, (next) => {
    state = next;
  });
  assert.equal(appliedOnUndefined, false);
  assert.equal(state.length, 1);

  const appliedOnValid = applyNonNullHydration([], (next) => {
    state = next;
  });
  assert.equal(appliedOnValid, true);
  assert.equal(state.length, 0);
});

test("EX48-03: computeHydrationRetryDelayMs gera backoff controlado sem loop infinito", () => {
  assert.equal(computeHydrationRetryDelayMs(0), 2000);
  assert.equal(computeHydrationRetryDelayMs(1), 5000);
  assert.equal(computeHydrationRetryDelayMs(2), 10000);
  assert.equal(computeHydrationRetryDelayMs(3), null);
  assert.equal(computeHydrationRetryDelayMs(-1), null);
});
