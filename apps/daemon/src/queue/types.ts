import type { CanalOrigem, StatusTarefa, TarefaRegistro } from "@criativo/contracts";

export interface EnqueueTaskInput {
  tarefa_id?: string;
  agente_id?: string | null;
  canal_origem?: CanalOrigem;
  tipo: string;
  titulo: string;
  prioridade?: number;
  payload: Record<string, unknown>;
  comando_id?: string;
}

export interface TarefaRow {
  tarefa_id: string;
  agente_id: string | null;
  canal_origem: CanalOrigem;
  tipo: string;
  titulo: string;
  prioridade: number;
  status: StatusTarefa;
  payload_json: string;
  resultado_json: string | null;
  erro_detalhes: string | null;
  tentativas: number;
  criado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
}

export interface RecoveryReport {
  totalInterrompidas: number;
  reenfileiradas: string[];
  marcadasFalha: string[];
  threadsInterrompidas?: number;
  entregasFilaInterrompidas?: number;
}

export function mapTarefaRow(row: TarefaRow): TarefaRegistro {
  return {
    tarefa_id: row.tarefa_id,
    agente_id: row.agente_id,
    canal_origem: row.canal_origem,
    tipo: row.tipo,
    titulo: row.titulo,
    prioridade: row.prioridade,
    status: row.status,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    resultado: row.resultado_json
      ? (JSON.parse(row.resultado_json) as Record<string, unknown>)
      : null,
    erro_detalhes: row.erro_detalhes,
    tentativas: row.tentativas,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
    concluido_em: row.concluido_em,
  };
}
