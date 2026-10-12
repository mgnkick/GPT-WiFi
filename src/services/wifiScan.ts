import { WifiNetwork } from '../types/wifi';
import { classifyWifiNetworks } from '../utils/meshDetector';
import { nativeWifiTools, normalizeWifiNetwork, requireAndroidNativeTools, NativeWifiInfo } from './nativeWifiTools';

export class WifiScanService {
  private currentNetworks: WifiNetwork[] = [];
  private subscribers: ((networks: WifiNetwork[]) => void)[] = [];
  private lastError = '';
  private lastWifiInfo: NativeWifiInfo | null = null;

  getNetworks(): WifiNetwork[] {
    return classifyWifiNetworks(this.currentNetworks);
  }

  getConnectedNetwork(): WifiNetwork | undefined {
    return this.currentNetworks.find(network => network.isConnected);
  }

  getLastError(): string {
    return this.lastError;
  }

  getConnectionInfo(): NativeWifiInfo | null {
    return this.lastWifiInfo ? { ...this.lastWifiInfo } : null;
  }

  subscribe(callback: (networks: WifiNetwork[]) => void): () => void {
    this.subscribers.push(callback);
    callback(this.getNetworks());
    return () => { this.subscribers = this.subscribers.filter(item => item !== callback); };
  }

  private notify(): void {
    const snapshot = this.getNetworks();
    this.subscribers.forEach(callback => callback(snapshot));
  }

  async refreshConnectionInfo(): Promise<NativeWifiInfo> {
    requireAndroidNativeTools();
    const info = await nativeWifiTools.getWifiInfo();
    this.lastWifiInfo = info;
    return info;
  }

  async triggerScan(): Promise<void> {
    await this.triggerRealScan();
  }

  async triggerRealScan(): Promise<void> {
    requireAndroidNativeTools();
    this.lastError = '';
    try {
      await nativeWifiTools.requestWifiPermissions();
      const [scan, info] = await Promise.all([
        nativeWifiTools.scanWifi(),
        nativeWifiTools.getWifiInfo(),
      ]);
      this.lastWifiInfo = info;
      const connectedBssid = info.bssid?.toLowerCase();
      const unique = new Map<string, WifiNetwork>();
      for (const raw of scan.networks || []) {
        const network = normalizeWifiNetwork({ ...raw, isConnected: Boolean(raw.isConnected || (connectedBssid && raw.bssid?.toLowerCase() === connectedBssid)) });
        const key = network.bssid !== '—' ? network.bssid.toLowerCase() : `${network.ssid}-${network.frequency}-${network.channel}`;
        const existing = unique.get(key);
        if (!existing || network.level > existing.level) unique.set(key, network);
      }
      this.currentNetworks = [...unique.values()].sort((a, b) => Number(Boolean(b.isConnected)) - Number(Boolean(a.isConnected)) || b.level - a.level);
      if (!this.currentNetworks.length) {
        this.lastError = 'Android не вернул доступных точек доступа. Проверьте, включены ли Wi-Fi и геолокация, и повторите сканирование.';
      }
      this.notify();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Не удалось просканировать Wi-Fi.';
      this.currentNetworks = [];
      try { this.lastWifiInfo = await nativeWifiTools.getWifiInfo(); } catch { this.lastWifiInfo = null; }
      this.notify();
      throw new Error(this.lastError);
    }
  }

  clearNetworks(): void {
    this.currentNetworks = [];
    this.notify();
  }

  destroy(): void {
    this.subscribers = [];
  }
}

export const wifiScanner = new WifiScanService();
