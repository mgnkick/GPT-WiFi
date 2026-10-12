import { LanDevice, SubnetScanProgress, DeviceCategory } from '../types/lanDevice';
import { nativeWifiTools, requireAndroidNativeTools, NativeSubnetProgress, NativePingResult } from './nativeWifiTools';

export function getSubnetFromGateway(gatewayIp: string): { prefix: string; networkCidr: string; startIp: string; endIp: string } {
  const parts = gatewayIp.trim().split('.').map(part => Number(part));
  if (parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) {
    // A gateway IP alone does not tell us the subnet mask. Android DHCP data supplies the real CIDR during scan.
    return { prefix: '', networkCidr: 'Подсеть определяется Android', startIp: '', endIp: '' };
  }
  return { prefix: '', networkCidr: 'Подсеть не определена', startIp: '', endIp: '' };
}


function mapDevice(raw: NativeSubnetProgress['foundDevices'][number]): LanDevice {
  return {
    ip: raw.ip,
    mac: raw.mac || '',
    hostname: raw.hostname || `Устройство (${raw.ip})`,
    vendor: raw.vendor || 'Не определён',
    category: (raw.category || 'other') as DeviceCategory,
    categoryLabel: raw.categoryLabel || 'Сетевое устройство',
    latencyMs: Number.isFinite(raw.latencyMs) ? raw.latencyMs : 0,
    status: 'online',
    isGateway: Boolean(raw.isGateway),
    openPorts: Array.isArray(raw.openPorts) ? raw.openPorts : [],
    openServices: Array.isArray(raw.openServices) ? raw.openServices : [],
    lastSeen: raw.lastSeen || 'Только что',
    details: raw.details,
  };
}

function mapProgress(raw: NativeSubnetProgress, startTime: number): SubnetScanProgress {
  return {
    gatewayIp: raw.gatewayIp,
    subnetPrefix: raw.subnetPrefix,
    networkCidr: raw.networkCidr,
    scannedCount: raw.scannedCount,
    totalCount: raw.totalCount,
    currentIp: raw.currentIp,
    progressPercent: raw.progressPercent,
    foundDevices: (raw.foundDevices || []).map(mapDevice),
    isScanning: raw.isScanning,
    scanDurationMs: Math.round(performance.now() - startTime),
  };
}

export async function scanLocalSubnet(
  onProgress: (progress: SubnetScanProgress) => void,
  signal?: AbortSignal,
): Promise<LanDevice[]> {
  requireAndroidNativeTools();
  if (signal?.aborted) return [];

  const startTime = performance.now();
  const progressHandle = await nativeWifiTools.addListener('scanProgress', raw => {
    onProgress(mapProgress(raw, startTime));
  });
  const cancel = () => {
    nativeWifiTools.cancelSubnetScan().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancel, { once: true });

  try {
    // The native side obtains the actual gateway and subnet mask from Android's active Wi-Fi DHCP data.
    const result = await nativeWifiTools.scanSubnet();
    const devices = (result.foundDevices || []).map(mapDevice);
    const subnet = result.subnetPrefix || '';
    onProgress({
      gatewayIp: result.gatewayIp || '',
      subnetPrefix: subnet,
      networkCidr: result.networkCidr,
      scannedCount: result.scannedCount,
      totalCount: result.totalCount,
      currentIp: result.foundDevices.at(-1)?.ip || '',
      progressPercent: 100,
      foundDevices: devices,
      isScanning: false,
      scanDurationMs: Math.round(performance.now() - startTime),
    });
    return devices;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await progressHandle.remove();
  }
}

export async function pingLanDevice(ip: string, count = 4): Promise<{
  avgMs: number;
  lossPct: number;
  samples: number[];
  isIcmp: boolean;
  ttl?: number;
  protocol: string;
}> {
  requireAndroidNativeTools();
  const result: NativePingResult = await nativeWifiTools.ping({ host: ip, count, sizeBytes: 64 });
  return {
    avgMs: result.avgMs,
    lossPct: result.lossPct,
    samples: (result.packets || []).map(packet => packet.latencyMs),
    isIcmp: true,
    ttl: result.ttl,
    protocol: result.protocol,
  };
}
