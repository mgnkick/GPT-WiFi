import { Network, ConnectionStatus } from '@capacitor/network';
import { Device, DeviceInfo } from '@capacitor/device';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { nativeWifiTools, NativeWifiInfo } from './nativeWifiTools';

export interface AndroidSystemStatus {
  isAndroid: boolean;
  deviceModel: string;
  osVersion: string;
  platform: string;
  isOnline: boolean;
  connectionType: 'wifi' | 'cellular' | 'none' | 'unknown';
  hasLocationPermission: boolean | 'prompt' | 'denied';
  isLocationAvailable: boolean;
}

type SettingsType = 'wifi' | 'vpn' | 'location';

class AndroidSystemService {
  private lastStatus: AndroidSystemStatus = {
    isAndroid: false,
    deviceModel: 'Устройство',
    osVersion: '',
    platform: 'web',
    isOnline: false,
    connectionType: 'unknown',
    hasLocationPermission: 'prompt',
    isLocationAvailable: false,
  };
  private listeners: Array<(status: AndroidSystemStatus) => void> = [];
  private settingsListeners: Array<(type: SettingsType) => void> = [];
  private networkListener: { remove: () => Promise<void> } | null = null;

  constructor() {
    void this.init();
  }

  onSettingsRequested(callback: (type: SettingsType) => void): () => void {
    this.settingsListeners.push(callback);
    return () => { this.settingsListeners = this.settingsListeners.filter(item => item !== callback); };
  }

  notifySettingsRequested(type: SettingsType): void {
    this.settingsListeners.forEach(callback => { try { callback(type); } catch { /* listener isolation */ } });
  }

  private async init(): Promise<void> {
    try {
      const info: DeviceInfo = await Device.getInfo();
      this.lastStatus.isAndroid = info.platform === 'android' || /android/i.test(navigator.userAgent);
      this.lastStatus.deviceModel = info.model || (this.lastStatus.isAndroid ? 'Android-устройство' : 'Браузер');
      this.lastStatus.osVersion = info.osVersion || info.operatingSystem || '';
      this.lastStatus.platform = info.platform;
      const network: ConnectionStatus = await Network.getStatus();
      this.applyNetworkStatus(network);
      this.networkListener = await Network.addListener('networkStatusChange', status => {
        this.applyNetworkStatus(status);
        this.notify();
      });
    } catch {
      this.lastStatus.isOnline = typeof navigator !== 'undefined' && navigator.onLine;
    }
    this.notify();
  }

  private applyNetworkStatus(status: ConnectionStatus): void {
    this.lastStatus.isOnline = status.connected;
    this.lastStatus.connectionType = (status.connectionType || 'unknown') as AndroidSystemStatus['connectionType'];
  }

  getStatus(): AndroidSystemStatus {
    return { ...this.lastStatus };
  }

  subscribe(callback: (status: AndroidSystemStatus) => void): () => void {
    this.listeners.push(callback);
    callback(this.getStatus());
    return () => { this.listeners = this.listeners.filter(item => item !== callback); };
  }

  private notify(): void {
    const status = this.getStatus();
    this.listeners.forEach(callback => { try { callback(status); } catch { /* listener isolation */ } });
  }

  // Location/Wi-Fi permission is requested when the user starts an actual Wi-Fi scan, not at app startup.
  async requestAllStartupPermissions(): Promise<void> {
    try {
      const status = await Network.getStatus();
      this.applyNetworkStatus(status);
      this.notify();
    } catch { /* Native plugin will report a real error on demand. */ }
  }

  async requestLocationPermission(): Promise<boolean> {
    try {
      const result = await nativeWifiTools.requestWifiPermissions();
      this.lastStatus.hasLocationPermission = result.granted;
      this.notify();
      return result.granted;
    } catch {
      this.lastStatus.hasLocationPermission = 'denied';
      this.notify();
      return false;
    }
  }

  async getWifiConnectionInfo(): Promise<NativeWifiInfo | null> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;
    try { return await nativeWifiTools.getWifiInfo(); } catch { return null; }
  }

  async getLocalLanIp(): Promise<string | null> {
    const info = await this.getWifiConnectionInfo();
    return info?.ipAddress && info.ipAddress !== '0.0.0.0' ? info.ipAddress : null;
  }

  async probeLocalGateway(): Promise<string | null> {
    const info = await this.getWifiConnectionInfo();
    return info?.gatewayIp && info.gatewayIp !== '0.0.0.0' ? info.gatewayIp : null;
  }

  getIntentUrl(intentAction: string): string {
    return `intent:#Intent;action=${intentAction};category=android.intent.category.DEFAULT;package=com.android.settings;end`;
  }

  getWifiSettingsIntentUrl(): string { return this.getIntentUrl('android.settings.WIFI_SETTINGS'); }
  getVpnSettingsIntentUrl(): string { return this.getIntentUrl('android.settings.VPN_SETTINGS'); }
  getLocationSettingsIntentUrl(): string { return this.getIntentUrl('android.settings.LOCATION_SOURCE_SETTINGS'); }

  launchIntent(intentAction: string): void {
    const actions: Array<[RegExp, SettingsType]> = [
      [/WIFI/, 'wifi'], [/VPN/, 'vpn'], [/LOCATION/, 'location'],
    ];
    for (const [pattern, type] of actions) if (pattern.test(intentAction)) this.notifySettingsRequested(type);

    const intentUrl = this.getIntentUrl(intentAction);
    if (Capacitor.isNativePlatform()) {
      AppLauncher.openUrl({ url: intentUrl })
        .catch(() => AppLauncher.openUrl({ url: this.getIntentUrl('android.settings.SETTINGS') }))
        .catch(() => undefined);
      return;
    }
    try { window.location.href = intentUrl; } catch { /* Browser doesn't support Android intents. */ }
  }

  openWifiSettings(): void { this.launchIntent('android.settings.WIFI_SETTINGS'); }
  openLocationSettings(): void { this.launchIntent('android.settings.LOCATION_SOURCE_SETTINGS'); }
  openVpnSettings(): void { this.launchIntent('android.settings.VPN_SETTINGS'); }
}

export const androidSystem = new AndroidSystemService();
