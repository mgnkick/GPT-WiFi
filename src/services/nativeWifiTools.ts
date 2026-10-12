import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { WifiNetwork } from '../types/wifi';

export interface NativeWifiInfo {
  wifiEnabled: boolean;
  vpnActive: boolean;
  connected: boolean;
  ssid: string;
  bssid: string;
  rssi: number;
  frequency: number;
  channel: number;
  channelWidth: number;
  band: '2.4GHz' | '5GHz' | '6GHz';
  capabilities: string;
  standard: string;
  securityType: 'WPA2' | 'WPA3' | 'WPA' | 'WEP' | 'Open' | 'Unknown';
  ipAddress: string;
  gatewayIp: string;
  netmask: string;
}

export interface NativePingPacket {
  seq: number;
  sizeBytes: number;
  latencyMs: number;
  isLoss: boolean;
  ttl?: number;
  timestamp: number;
}

export interface NativePingResult {
  host: string;
  protocol: string;
  isIcmp: boolean;
  sent: number;
  received: number;
  lossPct: number;
  minMs: number;
  avgMs: number;
  maxMs: number;
  jitterMs: number;
  ttl?: number;
  packets: NativePingPacket[];
  rawOutput?: string;
  error?: string;
}

interface NativeLanDevice {
  ip: string;
  mac: string;
  hostname: string;
  vendor: string;
  category: string;
  categoryLabel: string;
  latencyMs: number;
  status: 'online' | 'offline';
  isGateway: boolean;
  openPorts: number[];
  openServices: string[];
  lastSeen: string;
  details?: { webUiUrl?: string; description?: string };
}

export interface NativeSubnetProgress {
  gatewayIp: string;
  subnetPrefix: string;
  networkCidr?: string;
  scannedCount: number;
  totalCount: number;
  currentIp: string;
  progressPercent: number;
  foundDevices: NativeLanDevice[];
  isScanning: boolean;
  scanDurationMs: number;
}

interface WifiToolsPlugin {
  requestWifiPermissions(): Promise<{ granted: boolean }>;
  getWifiInfo(): Promise<NativeWifiInfo>;
  scanWifi(): Promise<{ networks: WifiNetwork[]; scanStarted: boolean; scanTimestamp: number; source: string }>;
  ping(options: { host: string; count: number; sizeBytes: number }): Promise<NativePingResult>;
  scanSubnet(): Promise<{
    gatewayIp: string;
    localIp: string;
    subnetPrefix: string;
    networkCidr: string;
    scannedCount: number;
    totalCount: number;
    foundDevices: NativeLanDevice[];
    cancelled: boolean;
  }>;
  cancelSubnetScan(): Promise<void>;
  addListener(eventName: 'scanProgress', listenerFunc: (progress: NativeSubnetProgress) => void): Promise<PluginListenerHandle>;
}

export const nativeWifiTools = registerPlugin<WifiToolsPlugin>('WifiTools');

export function requireAndroidNativeTools(): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('Эта функция использует Android API и доступна только в установленном Android-приложении.');
  }
}

export function normalizeWifiNetwork(raw: WifiNetwork): WifiNetwork {
  const frequency = Number.isFinite(raw.frequency) ? raw.frequency : 0;
  const band: WifiNetwork['band'] = frequency >= 5925 ? '6GHz' : frequency >= 4900 ? '5GHz' : '2.4GHz';
  return {
    ...raw,
    ssid: raw.ssid || '(скрытая сеть)',
    bssid: raw.bssid || '—',
    level: Number.isFinite(raw.level) ? raw.level : -100,
    frequency,
    channel: Number.isFinite(raw.channel) ? raw.channel : 0,
    channelWidth: ([20, 40, 80, 160, 320].includes(raw.channelWidth) ? raw.channelWidth : 0) as WifiNetwork['channelWidth'],
    band,
    capabilities: raw.capabilities || 'Не сообщается Android',
    standard: raw.standard || 'Wi-Fi (Legacy)',
    securityType: raw.securityType || 'Unknown',
    isConnected: Boolean(raw.isConnected),
  };
}
