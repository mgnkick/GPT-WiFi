import { SpeedtestResult } from '../types/wifi';
import { nativeWifiTools, requireAndroidNativeTools } from './nativeWifiTools';

export interface SpeedtestProgress {
  phase: 'idle' | 'ping' | 'download' | 'upload' | 'bufferbloat' | 'completed' | 'error';
  currentSpeedMbps: number;
  downloadSpeedMbps: number;
  uploadSpeedMbps: number;
  pingMs: number;
  jitterMs: number;
  progressPercent: number;
  bufferbloatLatencyMs: number;
  bufferbloatGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';
  historyPoints: number[];
}

const DOWNLOAD_URLS = [
  'https://speed.cloudflare.com/__down?bytes=10000000',
  'https://speed.cloudflare.com/__down?bytes=5000000',
];
const PING_HOST = '1.1.1.1';

export async function measurePing(iterations = 4): Promise<{ pingMs: number; jitterMs: number; packetLossPct: number }> {
  requireAndroidNativeTools();
  const count = Math.max(1, Math.min(20, Math.floor(iterations)));
  const result = await nativeWifiTools.ping({ host: PING_HOST, count, sizeBytes: 64 });
  return {
    pingMs: result.received > 0 ? result.avgMs : 0,
    jitterMs: result.received > 1 ? result.jitterMs : 0,
    packetLossPct: result.lossPct,
  };
}

export function isRussianEnvironment(): boolean {
  try {
    const language = (navigator.language || '').toLowerCase();
    if (language.startsWith('ru') || language.startsWith('be')) return true;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return /Moscow|Samara|Yekaterinburg|Novosibirsk|Minsk/i.test(timezone);
  } catch {
    return false;
  }
}

export interface PublicIpInfo {
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  isp?: string;
  org?: string;
  isVpn?: boolean;
  vpnReason?: string;
}

function assessPublicIpInfo(info: PublicIpInfo, explicitlyDetectedVpn = false): PublicIpInfo {
  // A hosting/datacenter ASN is only a clue, not proof that the phone is using a VPN.
  return {
    ...info,
    isVpn: explicitlyDetectedVpn,
    vpnReason: explicitlyDetectedVpn ? 'Внешний сервис классифицировал этот IP как VPN, прокси или Tor.' : undefined,
  };
}

export async function fetchIpAndIspInfo(): Promise<PublicIpInfo> {
  const endpoints: Array<() => Promise<PublicIpInfo | null>> = [
    async () => {
      const response = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(3500), cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json();
      if (data?.success === false || !data?.ip) return null;
      const isp = data.connection?.isp || '';
      const org = data.connection?.org || '';
      const info: PublicIpInfo = {
        ip: data.ip,
        city: data.city || undefined,
        region: data.region || undefined,
        country: data.country || undefined,
        countryCode: data.country_code || undefined,
        isp: isp || undefined,
        org: org || undefined,
      };
      return assessPublicIpInfo(info, Boolean(data.security?.vpn || data.security?.proxy || data.security?.tor));
    },
    async () => {
      const response = await fetch('https://freeipapi.com/api/json', { signal: AbortSignal.timeout(3500), cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data?.ipAddress) return null;
      return assessPublicIpInfo({
        ip: data.ipAddress,
        city: data.cityName || undefined,
        region: data.regionName || undefined,
        country: data.countryName || undefined,
        countryCode: data.countryCode || undefined,
        isp: data.asnOrganization || undefined,
        org: data.asn || undefined,
      });
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await endpoint();
      if (data) return data;
    } catch {
      // Try the next public IP information provider. No placeholder address is returned.
    }
  }
  return { ip: '' };
}

export function checkVpnHeuristics(
  infoOrIsp?: string | { isp?: string; countryCode?: string; country?: string; org?: string; isVpn?: boolean; vpnReason?: string },
): { vpnDetected: boolean; reason?: string } {
  if (infoOrIsp && typeof infoOrIsp === 'object' && infoOrIsp.isVpn) {
    return {
      vpnDetected: true,
      reason: infoOrIsp.vpnReason || `Внешний IP связан с организацией ${infoOrIsp.isp || infoOrIsp.org || 'неизвестно'}.`,
    };
  }
  const org = typeof infoOrIsp === 'string' ? infoOrIsp : `${infoOrIsp?.isp || ''} ${infoOrIsp?.org || ''}`;
  const possibleVpn = /vpn|proxy|hosting|datacenter|cloudflare warp/i.test(org);
  return { vpnDetected: possibleVpn, reason: possibleVpn ? `Предположительно VPN/хостинг по имени организации: ${org.trim()}.` : undefined };
}

export function calculateBufferbloatGrade(idlePing: number, loadedPing: number): { grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A'; deltaMs: number } {
  if (idlePing <= 0 || loadedPing <= 0) return { grade: 'N/A', deltaMs: 0 };
  const delta = Math.max(0, loadedPing - idlePing);
  if (delta < 5) return { grade: 'A+', deltaMs: delta };
  if (delta < 15) return { grade: 'A', deltaMs: delta };
  if (delta < 40) return { grade: 'B', deltaMs: delta };
  if (delta < 100) return { grade: 'C', deltaMs: delta };
  if (delta < 250) return { grade: 'D', deltaMs: delta };
  return { grade: 'F', deltaMs: delta };
}

export class SpeedtestRunner {
  private abortController: AbortController | null = null;
  private onProgress: (progress: SpeedtestProgress) => void;

  constructor(onProgress: (progress: SpeedtestProgress) => void) {
    this.onProgress = onProgress;
  }

  public stop(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private emit(progress: Omit<SpeedtestProgress, 'historyPoints'> & { historyPoints?: number[] }): void {
    this.onProgress({ ...progress, historyPoints: progress.historyPoints || [] });
  }

  public async run(): Promise<SpeedtestResult> {
    requireAndroidNativeTools();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const historyPoints: number[] = [];
    const baseProgress = {
      currentSpeedMbps: 0, downloadSpeedMbps: 0, uploadSpeedMbps: 0, pingMs: 0, jitterMs: 0,
      progressPercent: 0, bufferbloatLatencyMs: 0, bufferbloatGrade: 'N/A' as const,
    };
    const checkAborted = () => { if (signal.aborted) throw new Error('Тест остановлен пользователем.'); };

    this.emit({ ...baseProgress, phase: 'ping', progressPercent: 5, historyPoints });
    const idlePingStats = await measurePing(5);
    checkAborted();
    const idlePing = idlePingStats.pingMs;
    this.emit({ ...baseProgress, phase: 'download', pingMs: idlePing, jitterMs: idlePingStats.jitterMs, progressPercent: 15, historyPoints });

    const downloadStart = performance.now();
    let downloadedBytes = 0;
    let workerCount = 0;
    const downloadDurationMs = 6500;
    const loadedPingPromise = measurePing(5).catch(() => ({ pingMs: 0, jitterMs: 0, packetLossPct: 100 }));

    const downloadWorker = async (workerIndex: number) => {
      while (!signal.aborted && performance.now() - downloadStart < downloadDurationMs) {
        const url = `${DOWNLOAD_URLS[workerIndex % DOWNLOAD_URLS.length]}&run=${Date.now()}-${workerIndex}-${Math.random().toString(16).slice(2)}`;
        try {
          const response = await fetch(url, { signal, cache: 'no-store' });
          if (!response.ok) throw new Error(`Download endpoint returned HTTP ${response.status}`);
          const blob = await response.blob();
          if (!blob.size) throw new Error('Сервер тестирования вернул пустой файл.');
          downloadedBytes += blob.size;
          workerCount++;
          const seconds = Math.max(0.001, (performance.now() - downloadStart) / 1000);
          const currentSpeed = downloadedBytes * 8 / seconds / 1_000_000;
          historyPoints.push(Math.round(currentSpeed * 10) / 10);
          if (historyPoints.length > 40) historyPoints.shift();
          this.emit({
            ...baseProgress, phase: 'download', currentSpeedMbps: currentSpeed, downloadSpeedMbps: currentSpeed,
            pingMs: idlePing, jitterMs: idlePingStats.jitterMs,
            progressPercent: 15 + Math.min(45, Math.round((performance.now() - downloadStart) / downloadDurationMs * 45)),
            historyPoints: [...historyPoints],
          });
        } catch (error) {
          if (signal.aborted) return;
          // A reachable CDN may transiently fail a single request. Do not fabricate throughput.
          await new Promise(resolve => setTimeout(resolve, 120));
        }
      }
    };

    await Promise.all([downloadWorker(0), downloadWorker(1)]);
    checkAborted();
    const downloadSeconds = Math.max(0.1, (performance.now() - downloadStart) / 1000);
    const downloadMbps = Math.round((downloadedBytes * 8 / downloadSeconds / 1_000_000) * 10) / 10;
    if (downloadedBytes <= 0 || workerCount === 0) throw new Error('Не удалось скачать тестовые данные с speed.cloudflare.com. Проверьте доступ к интернету и повторите тест.');

    this.emit({ ...baseProgress, phase: 'bufferbloat', downloadSpeedMbps: downloadMbps, currentSpeedMbps: downloadMbps,
      pingMs: idlePing, jitterMs: idlePingStats.jitterMs, progressPercent: 62, historyPoints: [...historyPoints] });
    const loadedPingStats = await loadedPingPromise;
    checkAborted();
    const loadedPing = loadedPingStats.pingMs;
    const bufferbloat = calculateBufferbloatGrade(idlePing, loadedPing);

    this.emit({ ...baseProgress, phase: 'upload', currentSpeedMbps: 0, downloadSpeedMbps: downloadMbps,
      pingMs: idlePing, jitterMs: idlePingStats.jitterMs, progressPercent: 68,
      bufferbloatLatencyMs: bufferbloat.deltaMs, bufferbloatGrade: bufferbloat.grade, historyPoints: [] });

    const payload = new Uint8Array(512 * 1024);
    for (let offset = 0; offset < payload.length; offset += 65_536) {
      crypto.getRandomValues(payload.subarray(offset, Math.min(offset + 65_536, payload.length)));
    }
    const uploadStart = performance.now();
    let uploadedBytes = 0;
    const uploadDurationMs = 5000;
    const uploadHistory: number[] = [];
    let uploadRequests = 0;
    const uploadWorker = async () => {
      while (!signal.aborted && performance.now() - uploadStart < uploadDurationMs) {
        try {
          const response = await fetch('https://speed.cloudflare.com/__up', {
            method: 'POST', body: payload, signal, cache: 'no-store',
            headers: { 'Content-Type': 'application/octet-stream' },
          });
          if (!response.ok) throw new Error(`Upload endpoint returned HTTP ${response.status}`);
          await response.arrayBuffer().catch(() => undefined);
          uploadedBytes += payload.byteLength;
          uploadRequests++;
          const seconds = Math.max(0.001, (performance.now() - uploadStart) / 1000);
          const currentSpeed = uploadedBytes * 8 / seconds / 1_000_000;
          uploadHistory.push(Math.round(currentSpeed * 10) / 10);
          if (uploadHistory.length > 40) uploadHistory.shift();
          this.emit({ ...baseProgress, phase: 'upload', currentSpeedMbps: currentSpeed,
            downloadSpeedMbps: downloadMbps, uploadSpeedMbps: currentSpeed, pingMs: idlePing,
            jitterMs: idlePingStats.jitterMs, progressPercent: 68 + Math.min(27, Math.round((performance.now() - uploadStart) / uploadDurationMs * 27)),
            bufferbloatLatencyMs: bufferbloat.deltaMs, bufferbloatGrade: bufferbloat.grade, historyPoints: [...uploadHistory] });
        } catch {
          if (signal.aborted) return;
          await new Promise(resolve => setTimeout(resolve, 120));
        }
      }
    };
    await Promise.all([uploadWorker(), uploadWorker()]);
    checkAborted();
    const uploadSeconds = Math.max(0.1, (performance.now() - uploadStart) / 1000);
    const uploadMbps = Math.round((uploadedBytes * 8 / uploadSeconds / 1_000_000) * 10) / 10;
    if (uploadedBytes <= 0 || uploadRequests === 0) throw new Error('Не удалось передать тестовые данные на speed.cloudflare.com. Возможно, POST-запросы блокируются сетью.');

    const ipInfo = await fetchIpAndIspInfo();
    checkAborted();
    const result: SpeedtestResult = {
      downloadMbps,
      uploadMbps,
      pingMs: idlePing,
      jitterMs: idlePingStats.jitterMs,
      packetLossPct: idlePingStats.packetLossPct,
      timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      bufferbloatGrade: bufferbloat.grade,
      bufferbloatLatencyMs: bufferbloat.deltaMs,
      ipInfo: ipInfo.ip ? ipInfo : undefined,
      server: 'Cloudflare speed.cloudflare.com',
    };
    this.emit({ ...baseProgress, phase: 'completed', currentSpeedMbps: downloadMbps,
      downloadSpeedMbps: downloadMbps, uploadSpeedMbps: uploadMbps, pingMs: idlePing,
      jitterMs: idlePingStats.jitterMs, progressPercent: 100, bufferbloatLatencyMs: bufferbloat.deltaMs,
      bufferbloatGrade: bufferbloat.grade, historyPoints: [...uploadHistory] });
    return result;
  }
}
