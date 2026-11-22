import type { AgentMailboxItem } from "@criativo/contracts";
import type { EnqueueMailboxInput, MailboxStore } from "./mailbox-store.ts";

export interface MailboxDeliveryGateOptions {
  store: MailboxStore;
  leaseOwner?: string;
  leaseMs?: number;
  isAgentBusy?: (agenteId: string) => boolean;
  onDeliver?: (item: AgentMailboxItem) => Promise<void> | void;
}

/**
 * Coordena entregas ordenadas por agente: garante que apenas um item por vez
 * seja despachado quando o agente estiver ocioso, mantendo os demais em `pending`.
 */
export class MailboxDeliveryGate {
  private readonly store: MailboxStore;
  private readonly leaseOwner: string;
  private readonly leaseMs: number;
  private readonly isAgentBusyFn: (agenteId: string) => boolean;
  private readonly onDeliverFn?: (item: AgentMailboxItem) => Promise<void> | void;
  private readonly activeDeliveries = new Set<string>();

  constructor(options: MailboxDeliveryGateOptions) {
    this.store = options.store;
    this.leaseOwner = options.leaseOwner ?? `daemon-${process.pid}`;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.isAgentBusyFn = options.isAgentBusy ?? (() => false);
    this.onDeliverFn = options.onDeliver;
  }

  public async enqueueAndTryDeliver(
    input: EnqueueMailboxInput,
    overrideDeliver?: (item: AgentMailboxItem) => Promise<void> | void
  ): Promise<{ item: AgentMailboxItem; inserted: boolean; dispatched: boolean }> {
    const { item, inserted } = this.store.enqueue(input);
    const dispatched = await this.tryDispatchNext(input.agente_id, overrideDeliver);
    const reloaded = this.store.getById(item.mailbox_id) ?? item;
    return { item: reloaded, inserted, dispatched };
  }

  public async tryDispatchNext(
    agenteId: string,
    overrideDeliver?: (item: AgentMailboxItem) => Promise<void> | void
  ): Promise<boolean> {
    if (this.activeDeliveries.has(agenteId) || this.isAgentBusyFn(agenteId)) {
      return false;
    }

    const claimed = this.store.claimNextForAgent(agenteId, this.leaseOwner, this.leaseMs);
    if (!claimed) return false;

    const deliver = overrideDeliver ?? this.onDeliverFn;
    if (!deliver) {
      // Quando não há handler acoplado (ex.: apenas enfileiramento durável), retorna ao gate ou mantém entregue
      this.store.markDelivered(claimed.mailbox_id);
      return true;
    }

    this.activeDeliveries.add(agenteId);
    try {
      await deliver(claimed);
      this.store.markDelivered(claimed.mailbox_id);
      this.store.ack(claimed.mailbox_id);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.failOrDeadLetter(claimed.mailbox_id, msg);
      return false;
    } finally {
      this.activeDeliveries.delete(agenteId);
    }
  }
}
