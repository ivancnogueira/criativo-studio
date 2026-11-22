import { createHash } from "node:crypto";

export interface TransferChunkPacket {
  index: number;
  totalChunks: number;
  chunkSha256: string;
  dataBase64: string;
}

export function splitPayloadIntoChunks(
  serializedUtf8: string,
  chunkSizeBytes = 256 * 1024,
): TransferChunkPacket[] {
  const buf = Buffer.from(serializedUtf8, "utf8");
  const step = Math.max(512, chunkSizeBytes);
  const totalChunks = Math.max(1, Math.ceil(buf.length / step));
  const packets: TransferChunkPacket[] = [];

  for (let index = 0; index < totalChunks; index += 1) {
    const slice = buf.subarray(index * step, (index + 1) * step);
    const chunkSha256 = createHash("sha256").update(slice).digest("hex");
    packets.push({
      index,
      totalChunks,
      chunkSha256,
      dataBase64: slice.toString("base64"),
    });
  }

  return packets;
}

export function verifyAndAssembleChunks(params: {
  packets: TransferChunkPacket[];
  expectedTotalChunks: number;
  expectedPayloadSha256: string;
}): string {
  if (params.packets.length !== params.expectedTotalChunks) {
    throw new Error(
      `Contagem de chunks divergente: recebidos ${params.packets.length}, esperados ${params.expectedTotalChunks}.`,
    );
  }

  const ordered = [...params.packets].sort((a, b) => a.index - b.index);
  const buffers: Buffer[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const pkt = ordered[i]!;
    if (pkt.index !== i) {
      throw new Error(`Chunk fora de sequência ou faltando índice ${i}.`);
    }
    const raw = Buffer.from(pkt.dataBase64, "base64");
    const actualChunkHash = createHash("sha256").update(raw).digest("hex");
    if (actualChunkHash !== pkt.chunkSha256) {
      throw new Error(`Falha de integridade SHA-256 no chunk ${i}.`);
    }
    buffers.push(raw);
  }

  const assembled = Buffer.concat(buffers).toString("utf8");
  const finalHash = createHash("sha256").update(assembled, "utf8").digest("hex");
  if (finalHash !== params.expectedPayloadSha256) {
    throw new Error("Hash SHA-256 global do pacote não confere após remontagem dos chunks.");
  }

  return assembled;
}
