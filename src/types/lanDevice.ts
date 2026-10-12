export type DeviceCategory = 
  | 'router'
  | 'tv'
  | 'nas'
  | 'pc'
  | 'phone'
  | 'camera'
  | 'printer'
  | 'iot'
  | 'other';

export interface LanDevice {
  ip: string;
  mac: string;
  hostname: string;
  vendor: string;
  category: DeviceCategory;
  categoryLabel: string;
  latencyMs: number;
  status: 'online' | 'offline';
  isGateway?: boolean;
  openPorts: number[];
  openServices: string[];
  lastSeen: string;
  details?: {
    model?: string;
    os?: string;
    webUiUrl?: string;
    description?: string;
  };
}

export interface SubnetScanProgress {
  gatewayIp: string;
  subnetPrefix: string; // derived prefix for progress display
  networkCidr?: string; // actual subnet derived from Android DHCP netmask
  scannedCount: number; // 0 to 256
  totalCount: number; // number of host addresses checked
  currentIp: string;
  progressPercent: number; // 0 to 100
  foundDevices: LanDevice[];
  isScanning: boolean;
  scanDurationMs: number;
}
