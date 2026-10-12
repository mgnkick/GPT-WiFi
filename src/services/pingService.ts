import { DetailedHostPing, DualPingResult, PingPacketItem } from '../types/wifi';
import { nativeWifiTools, requireAndroidNativeTools } from './nativeWifiTools';

const PACKET_SIZE_BYTES = 64;

export function createEmptyHostPing(targetName: string, host: string): DetailedHostPing {
  return {
    targetName, host, packetsCount: 0, packetSizeBytes: PACKET_SIZE_BYTES,
    sent: 0, received: 0, lossPct: 0, minMs: 0, avgMs: 0, maxMs: 0, jitterMs: 0,
    protocol: 'Ожидает измерения', packets: [],
  };
}

function toDetailedHostPing(
  targetName: string,
  host: string,
  result: Awaited<ReturnType<typeof nativeWifiTools.ping>>,
): DetailedHostPing {
  const packets: PingPacketItem[] = (result.packets || []).map(packet => ({
    seq: packet.seq,
    sizeBytes: packet.sizeBytes || PACKET_SIZE_BYTES,
    latencyMs: packet.latencyMs,
    isLoss: packet.isLoss,
    ttl: packet.ttl,
    timestamp: packet.timestamp,
  }));
  return {
    targetName,
    host,
    packetsCount: result.sent,
    packetSizeBytes: PACKET_SIZE_BYTES,
    sent: result.sent,
    received: result.received,
    lossPct: result.lossPct,
    minMs: result.minMs,
    avgMs: result.avgMs,
    maxMs: result.maxMs,
    jitterMs: result.jitterMs,
    protocol: result.protocol,
    isIcmp: result.isIcmp,
    ttl: result.ttl,
    rawOutput: result.rawOutput,
    packets,
  };
}

export async function executeHostPing(
  targetName: string,
  host: string,
  _probeUrl?: string,
  _unusedBaseMs?: number,
  _unusedJitter?: number,
  onPacketUpdate?: (currentPackets: PingPacketItem[], currentProgressPct: number) => void,
): Promise<DetailedHostPing> {
  requireAndroidNativeTools();
  const result = await nativeWifiTools.ping({ host: host.trim(), count: 10, sizeBytes: PACKET_SIZE_BYTES });
  const detailed = toDetailedHostPing(targetName, host.trim(), result);
  if (onPacketUpdate) {
    for (let i = 0; i < detailed.packets.length; i++) {
      onPacketUpdate(detailed.packets.slice(0, i + 1), Math.round(((i + 1) / Math.max(1, detailed.sent)) * 100));
    }
    if (!detailed.packets.length) onPacketUpdate([], 100);
  }
  return detailed;
}

export async function runDualPingTest(
  gatewayIp = '',
  onUpdate?: (data: { gateway?: DetailedHostPing; yandex?: DetailedHostPing; currentTarget: 'gateway' | 'yandex' | 'idle' }) => void,
): Promise<DualPingResult> {
  requireAndroidNativeTools();
  const connection = await nativeWifiTools.getWifiInfo().catch(() => null);
  const actualGateway = connection?.gatewayIp && connection.gatewayIp !== '0.0.0.0' ? connection.gatewayIp : gatewayIp;
  onUpdate?.({ currentTarget: 'gateway' });
  const gateway = actualGateway && actualGateway !== '0.0.0.0'
    ? await executeHostPing('Основной роутер (шлюз)', actualGateway)
    : createEmptyHostPing('Основной роутер (шлюз)', 'Шлюз не определён');
  onUpdate?.({ currentTarget: 'yandex', gateway });
  const internet = await executeHostPing('Интернет-узел (ya.ru)', 'ya.ru');
  onUpdate?.({ currentTarget: 'idle', gateway, yandex: internet });
  return { gateway, yandex: internet, timestamp: new Date().toISOString() };
}

export async function executeDirectIcmpPing(
  host: string,
  count = 4,
  onPacketUpdate?: (currentPackets: PingPacketItem[], currentProgressPct: number) => void,
): Promise<DetailedHostPing> {
  requireAndroidNativeTools();
  const cleanHost = host.trim();
  if (!cleanHost) throw new Error('Укажите IP-адрес или имя узла.');
  const result = await nativeWifiTools.ping({ host: cleanHost, count, sizeBytes: PACKET_SIZE_BYTES });
  const detailed = toDetailedHostPing(cleanHost, cleanHost, result);
  if (onPacketUpdate) {
    for (let i = 0; i < detailed.packets.length; i++) {
      onPacketUpdate(detailed.packets.slice(0, i + 1), Math.round(((i + 1) / Math.max(1, detailed.sent)) * 100));
    }
    if (!detailed.packets.length) onPacketUpdate([], 100);
  }
  return detailed;
}
