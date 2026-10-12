package ru.wifiexpert.helper;

import android.Manifest;
import android.content.Context;
import android.location.LocationManager;
import android.net.DhcpInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.ScanResult;
import android.net.wifi.SupplicantState;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

@CapacitorPlugin(
    name = "WifiTools",
    permissions = {
        @Permission(
            alias = "wifiScan",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.NEARBY_WIFI_DEVICES
            }
        )
    }
)
public class WifiToolsPlugin extends Plugin {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean cancelSubnetScan = false;

    @PluginMethod
    public void requestWifiPermissions(PluginCall call) {
        if (getPermissionState("wifiScan") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("wifiScan", call, "wifiPermissionCallback");
    }

    @PermissionCallback
    private void wifiPermissionCallback(PluginCall call) {
        boolean granted = getPermissionState("wifiScan") == PermissionState.GRANTED;
        if (granted) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
        } else call.reject("Для сканирования Wi-Fi необходимо разрешить доступ к ближайшим Wi-Fi-устройствам и геолокации в Android.", "PERMISSION_DENIED");
    }

    @PluginMethod
    public void getWifiInfo(PluginCall call) {
        try {
            call.resolve(connectionInfo());
        } catch (Exception ex) {
            call.reject("Не удалось получить параметры Wi-Fi: " + ex.getMessage(), "WIFI_INFO_ERROR");
        }
    }

    @PluginMethod
    public void scanWifi(PluginCall call) {
        if (getPermissionState("wifiScan") != PermissionState.GRANTED) {
            call.reject("Сначала разрешите доступ к Wi-Fi и геолокации.", "PERMISSION_DENIED");
            return;
        }
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null || !wifi.isWifiEnabled()) {
            call.reject("Wi-Fi выключен. Включите Wi-Fi в настройках Android.", "WIFI_DISABLED");
            return;
        }
        if (!isLocationEnabled()) {
            call.reject("Для сканирования сетей на этой версии Android необходимо включить службу геолокации.", "LOCATION_DISABLED");
            return;
        }
        boolean scanStarted;
        try {
            scanStarted = wifi.startScan();
        } catch (SecurityException ex) {
            call.reject("Android запретил сканирование Wi-Fi. Проверьте разрешения приложения.", "PERMISSION_DENIED");
            return;
        }
        // Android throttles scans. Returning current framework results is preferable to inventing data.
        mainHandler.postDelayed(() -> {
            try {
                List<ScanResult> results = wifi.getScanResults();
                JSArray networks = new JSArray();
                String connectedBssid = null;
                WifiInfo current = wifi.getConnectionInfo();
                if (current != null && validValue(current.getBSSID())) connectedBssid = current.getBSSID();
                boolean connectedIncluded = false;
                for (ScanResult result : results) {
                    JSObject item = scanResultToJson(result, connectedBssid != null && connectedBssid.equalsIgnoreCase(result.BSSID));
                    if (item != null) {
                        networks.put(item);
                        if (item.optBoolean("isConnected", false)) connectedIncluded = true;
                    }
                }
                if (!connectedIncluded && current != null && validValue(current.getSSID()) && validValue(current.getBSSID()) && current.getRssi() <= 0 && current.getFrequency() > 0) {
                    networks.put(connectionToNetworkJson(current));
                }
                JSObject out = new JSObject();
                out.put("networks", networks);
                out.put("scanStarted", scanStarted);
                out.put("scanTimestamp", System.currentTimeMillis());
                out.put("source", "Android WifiManager scan results");
                call.resolve(out);
            } catch (SecurityException ex) {
                call.reject("Нет разрешения на чтение результатов Wi-Fi-сканирования.", "PERMISSION_DENIED");
            } catch (Exception ex) {
                call.reject("Ошибка чтения результатов Wi-Fi: " + ex.getMessage(), "WIFI_SCAN_ERROR");
            }
        }, 1800);
    }

    @PluginMethod
    public void ping(PluginCall call) {
        String host = call.getString("host", "").trim();
        int count = Math.max(1, Math.min(20, call.getInt("count", 4)));
        int size = Math.max(0, Math.min(1400, call.getInt("sizeBytes", 56)));
        if (!host.matches("[A-Za-z0-9._:%-]+") || host.startsWith("-") || host.isEmpty()) {
            call.reject("Укажите корректный IP-адрес или имя узла.", "INVALID_HOST");
            return;
        }
        Thread worker = new Thread(() -> {
            try {
                JSObject result = executePing(host, count, size);
                call.resolve(result);
            } catch (Exception ex) {
                call.reject("Не удалось выполнить ping: " + ex.getMessage(), "PING_ERROR");
            }
        }, "WifiTools-ping");
        worker.start();
    }

    @PluginMethod
    public void cancelSubnetScan(PluginCall call) {
        cancelSubnetScan = true;
        call.resolve();
    }

    @PluginMethod
    public void scanSubnet(PluginCall call) {
        cancelSubnetScan = false;
        Thread worker = new Thread(() -> {
            try {
                JSObject connection = connectionInfo();
                String gateway = connection.optString("gatewayIp", "");
                String localIp = connection.optString("ipAddress", "");
                String netmask = connection.optString("netmask", "");
                if (gateway.isEmpty() || localIp.isEmpty() || netmask.isEmpty() || "0.0.0.0".equals(gateway)) {
                    call.reject("Android не предоставил параметры локальной Wi-Fi-сети. Подключитесь к Wi-Fi и повторите сканирование.", "NO_LOCAL_NETWORK");
                    return;
                }
                long local = ipToLong(localIp);
                long mask = ipToLong(netmask);
                long network = local & mask;
                long broadcast = network | (~mask & 0xffffffffL);
                long hostCount = broadcast - network - 1;
                if (hostCount < 1 || hostCount > 1022) {
                    call.reject("Размер локальной подсети слишком большой для безопасного сканирования: " + hostCount + " адресов.", "SUBNET_TOO_LARGE");
                    return;
                }
                String prefix = ipFromLong(network).substring(0, ipFromLong(network).lastIndexOf('.') + 1);
                String cidr = ipFromLong(network) + "/" + Long.bitCount(mask);
                List<String> addresses = new ArrayList<>();
                for (long ip = network + 1; ip < broadcast; ip++) {
                    if (ip != local) addresses.add(ipFromLong(ip));
                }
                List<JSObject> found = Collections.synchronizedList(new ArrayList<>());
                ExecutorService pool = Executors.newFixedThreadPool(48);
                CompletionService<JSObject> completion = new ExecutorCompletionService<>(pool);
                int submitted = 0;
                for (String ip : addresses) {
                    if (cancelSubnetScan) break;
                    final String targetIp = ip;
                    final boolean isGateway = targetIp.equals(gateway);
                    completion.submit(() -> probeHost(targetIp, isGateway));
                    submitted++;
                }
                int complete = 0;
                while (complete < submitted && !cancelSubnetScan) {
                    Future<JSObject> future = completion.take();
                    complete++;
                    try {
                        JSObject device = future.get();
                        if (device != null) found.add(device);
                    } catch (Exception ignored) {}
                    if (complete % 12 == 0 || complete == submitted) {
                        JSArray snapshot = new JSArray();
                        synchronized (found) { for (JSObject item : found) snapshot.put(item); }
                        JSObject progress = new JSObject();
                        progress.put("gatewayIp", gateway);
                        progress.put("subnetPrefix", prefix);
                        progress.put("networkCidr", cidr);
                        progress.put("scannedCount", complete);
                        progress.put("totalCount", addresses.size());
                        progress.put("currentIp", "");
                        progress.put("progressPercent", addresses.isEmpty() ? 100 : Math.round((complete * 100f) / addresses.size()));
                        progress.put("foundDevices", snapshot);
                        progress.put("isScanning", complete < submitted && !cancelSubnetScan);
                        progress.put("scanDurationMs", 0);
                        notifyListeners("scanProgress", progress);
                    }
                }
                pool.shutdownNow();
                found.sort((a, b) -> {
                    boolean ga = a.optBoolean("isGateway", false), gb = b.optBoolean("isGateway", false);
                    if (ga != gb) return ga ? -1 : 1;
                    return Long.compare(safeLongIp(a.optString("ip", "0.0.0.0")), safeLongIp(b.optString("ip", "0.0.0.0")));
                });
                JSArray outDevices = new JSArray();
                for (JSObject item : found) outDevices.put(item);
                JSObject result = new JSObject();
                result.put("gatewayIp", gateway);
                result.put("localIp", localIp);
                result.put("subnetPrefix", prefix);
                result.put("networkCidr", cidr);
                result.put("scannedCount", complete);
                result.put("totalCount", addresses.size());
                result.put("foundDevices", outDevices);
                result.put("cancelled", cancelSubnetScan);
                call.resolve(result);
            } catch (Exception ex) {
                call.reject("Ошибка сканирования локальной сети: " + ex.getMessage(), "LAN_SCAN_ERROR");
            }
        }, "WifiTools-subnet-scan");
        worker.start();
    }

    private JSObject connectionInfo() {
        JSObject out = new JSObject();
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        boolean wifiEnabled = wifi != null && wifi.isWifiEnabled();
        out.put("wifiEnabled", wifiEnabled);
        boolean vpnActive = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network active = cm == null ? null : cm.getActiveNetwork();
            NetworkCapabilities caps = cm == null || active == null ? null : cm.getNetworkCapabilities(active);
            vpnActive = caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
        } catch (Exception ignored) {}
        out.put("vpnActive", vpnActive);
        out.put("connected", false);
        out.put("ssid", "");
        out.put("bssid", "");
        out.put("rssi", 0);
        out.put("frequency", 0);
        out.put("channel", 0);
        out.put("channelWidth", 0);
        out.put("band", "2.4GHz");
        out.put("capabilities", "");
        out.put("standard", "Wi-Fi (Legacy)");
        out.put("securityType", "Unknown");
        out.put("ipAddress", "");
        out.put("gatewayIp", "");
        out.put("netmask", "");
        if (wifi == null) return out;
        try {
            WifiInfo info = wifi.getConnectionInfo();
            if (info != null) {
                boolean connected = info.getNetworkId() != -1 && info.getSupplicantState() == SupplicantState.COMPLETED;
                out.put("connected", connected);
                out.put("ssid", cleanSsid(info.getSSID()));
                out.put("bssid", validValue(info.getBSSID()) ? info.getBSSID() : "");
                out.put("rssi", info.getRssi());
                out.put("frequency", info.getFrequency());
                out.put("channel", frequencyToChannel(info.getFrequency()));
                out.put("band", bandForFrequency(info.getFrequency()));
                out.put("capabilities", "");
                out.put("channelWidth", channelWidthFromWifiInfo(info));
                out.put("standard", wifiStandard(info));
                out.put("securityType", "Unknown");
            }
            DhcpInfo dhcp = wifi.getDhcpInfo();
            if (dhcp != null) {
                out.put("ipAddress", intToIpv4(dhcp.ipAddress));
                out.put("gatewayIp", intToIpv4(dhcp.gateway));
                out.put("netmask", intToIpv4(dhcp.netmask));
            }
        } catch (SecurityException ignored) {}
        return out;
    }

    private JSObject scanResultToJson(ScanResult result, boolean connected) {
        if (result == null) return null;
        JSObject out = new JSObject();
        String caps = result.capabilities == null ? "" : result.capabilities;
        int frequency = result.frequency;
        int channelWidth = 20;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            switch (result.channelWidth) {
                case ScanResult.CHANNEL_WIDTH_40MHZ: channelWidth = 40; break;
                case ScanResult.CHANNEL_WIDTH_80MHZ: channelWidth = 80; break;
                case ScanResult.CHANNEL_WIDTH_160MHZ:
                case ScanResult.CHANNEL_WIDTH_80MHZ_PLUS_MHZ: channelWidth = 160; break;
                default: channelWidth = 20;
            }
        }
        out.put("ssid", result.SSID == null ? "" : result.SSID);
        out.put("bssid", result.BSSID == null ? "" : result.BSSID);
        out.put("level", result.level);
        out.put("frequency", frequency);
        out.put("channel", frequencyToChannel(frequency));
        out.put("channelWidth", channelWidth);
        out.put("band", bandForFrequency(frequency));
        out.put("capabilities", caps);
        out.put("standard", wifiStandard(result));
        out.put("securityType", securityType(caps));
        out.put("isConnected", connected);
        out.put("timestamp", result.timestamp > 0 ? result.timestamp / 1000 : System.currentTimeMillis());
        return out;
    }

    private JSObject connectionToNetworkJson(WifiInfo info) {
        JSObject out = new JSObject();
        int frequency = info.getFrequency();
        out.put("ssid", cleanSsid(info.getSSID()));
        out.put("bssid", validValue(info.getBSSID()) ? info.getBSSID() : "");
        out.put("level", info.getRssi());
        out.put("frequency", frequency);
        out.put("channel", frequencyToChannel(frequency));
        out.put("channelWidth", channelWidthFromWifiInfo(info));
        out.put("band", bandForFrequency(frequency));
        out.put("capabilities", "");
        out.put("standard", wifiStandard(info));
        out.put("securityType", "Unknown");
        out.put("isConnected", true);
        out.put("timestamp", System.currentTimeMillis());
        return out;
    }

    private JSObject executePing(String host, int count, int size) throws Exception {
        int payloadSize = Math.max(0, size - 8);
        Process process = new ProcessBuilder("/system/bin/ping", "-c", String.valueOf(count), "-s", String.valueOf(payloadSize), "-W", "2", host).redirectErrorStream(true).start();
        StringBuilder raw = new StringBuilder();
        List<JSObject> packets = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                raw.append(line).append('\n');
                if (line.contains("bytes from") && line.contains("time")) {
                    java.util.regex.Matcher tm = java.util.regex.Pattern.compile("time[=<]([0-9.]+)\\s*ms").matcher(line);
                    java.util.regex.Matcher sm = java.util.regex.Pattern.compile("icmp_seq[= ]([0-9]+)").matcher(line);
                    java.util.regex.Matcher ttlm = java.util.regex.Pattern.compile("ttl[= ]([0-9]+)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(line);
                    double latency = tm.find() ? Double.parseDouble(tm.group(1)) : 0.0;
                    int seq = sm.find() ? Integer.parseInt(sm.group(1)) : packets.size() + 1;
                    JSObject item = new JSObject();
                    item.put("seq", seq);
                    item.put("sizeBytes", size);
                    item.put("latencyMs", latency);
                    item.put("isLoss", false);
                    if (ttlm.find()) item.put("ttl", Integer.parseInt(ttlm.group(1)));
                    item.put("timestamp", System.currentTimeMillis());
                    packets.add(item);
                }
            }
        }
        process.waitFor();
        String output = raw.toString();
        java.util.regex.Matcher loss = java.util.regex.Pattern.compile("([0-9.]+)%\\s*packet loss", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(output);
        double lossPct = loss.find() ? Double.parseDouble(loss.group(1)) : ((count - packets.size()) * 100.0 / count);
        double min = 0, avg = 0, max = 0, jitter = 0;
        java.util.regex.Matcher stats = java.util.regex.Pattern.compile("(?:rtt|round-trip) min/avg/max/(?:mdev|stddev) = ([0-9.]+)/([0-9.]+)/([0-9.]+)/([0-9.]+)").matcher(output);
        if (stats.find()) {
            min = Double.parseDouble(stats.group(1)); avg = Double.parseDouble(stats.group(2));
            max = Double.parseDouble(stats.group(3)); jitter = Double.parseDouble(stats.group(4));
        } else if (!packets.isEmpty()) {
            double sum = 0; min = Double.MAX_VALUE;
            for (JSObject item : packets) {
                double value = item.optDouble("latencyMs", 0); sum += value; min = Math.min(min, value); max = Math.max(max, value);
            }
            avg = sum / packets.size();
            double delta = 0;
            for (int i = 1; i < packets.size(); i++) delta += Math.abs(packets.get(i).optDouble("latencyMs", 0) - packets.get(i - 1).optDouble("latencyMs", 0));
            jitter = packets.size() > 1 ? delta / (packets.size() - 1) : 0;
        }
        JSArray packetArray = new JSArray();
        for (JSObject item : packets) packetArray.put(item);
        JSObject result = new JSObject();
        result.put("host", host); result.put("protocol", "ICMP Echo (Android ping)"); result.put("isIcmp", true);
        result.put("sent", count); result.put("received", packets.size()); result.put("lossPct", round1(lossPct));
        result.put("minMs", round1(min)); result.put("avgMs", round1(avg)); result.put("maxMs", round1(max)); result.put("jitterMs", round1(jitter));
        if (!packets.isEmpty() && packets.get(0).has("ttl")) result.put("ttl", packets.get(0).optInt("ttl"));
        result.put("packets", packetArray); result.put("rawOutput", output);
        if (packets.isEmpty()) result.put("error", "Узел не ответил на ICMP Echo Request.");
        return result;
    }

    private JSObject probeHost(String ip, boolean gateway) {
        int[] ports = new int[]{80, 443, 22, 53, 445, 139, 554, 8008, 8080, 8443, 9100, 3389};
        List<Integer> open = new ArrayList<>();
        double firstLatency = 0;
        for (int port : ports) {
            if (cancelSubnetScan) return null;
            long start = System.nanoTime();
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(ip, port), 120);
                double elapsed = (System.nanoTime() - start) / 1_000_000.0;
                open.add(port);
                if (firstLatency == 0) firstLatency = elapsed;
            } catch (Exception ignored) {}
        }
        if (open.isEmpty()) {
            try {
                long start = System.nanoTime();
                if (!InetAddress.getByName(ip).isReachable(180)) return null;
                firstLatency = (System.nanoTime() - start) / 1_000_000.0;
            } catch (Exception ex) { return null; }
        }
        JSArray portsJson = new JSArray();
        JSArray servicesJson = new JSArray();
        for (int port : open) { portsJson.put(port); servicesJson.put(serviceName(port)); }
        JSObject device = new JSObject();
        device.put("ip", ip); device.put("mac", lookupMacAddress(ip));
        device.put("hostname", gateway ? "Шлюз" : "Устройство (" + ip + ")");
        device.put("vendor", "");
        device.put("category", classifyDevice(open, gateway));
        device.put("categoryLabel", classifyDeviceLabel(open, gateway));
        device.put("latencyMs", round1(Math.max(0, firstLatency)));
        device.put("status", "online"); device.put("isGateway", gateway);
        device.put("openPorts", portsJson); device.put("openServices", servicesJson);
        device.put("lastSeen", "Только что");
        JSObject details = new JSObject();
        if (open.contains(80) || open.contains(443)) details.put("webUiUrl", (open.contains(443) ? "https://" : "http://") + ip);
        details.put("description", gateway ? "Шлюз текущей локальной сети." : "Узел ответил на сетевую проверку; тип устройства определён только по открытым портам.");
        device.put("details", details);
        return device;
    }

    private String lookupMacAddress(String ip) {
        try (BufferedReader reader = new BufferedReader(new FileReader("/proc/net/arp"))) {
            String line; reader.readLine();
            while ((line = reader.readLine()) != null) {
                String[] fields = line.trim().split("\\s+");
                if (fields.length >= 4 && fields[0].equals(ip) && !"00:00:00:00:00:00".equals(fields[3])) return fields[3].toUpperCase(Locale.US);
            }
        } catch (Exception ignored) {}
        return "";
    }

    private boolean isLocationEnabled() {
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return lm.isLocationEnabled();
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception ex) { return false; }
    }

    private static int frequencyToChannel(int frequency) {
        if (frequency == 2484) return 14;
        if (frequency >= 2412 && frequency <= 2472) return (frequency - 2407) / 5;
        if (frequency >= 5000 && frequency < 5950) return (frequency - 5000) / 5;
        if (frequency >= 5955 && frequency <= 7115) return (frequency - 5950) / 5;
        return 0;
    }

    private static String bandForFrequency(int frequency) {
        if (frequency >= 5925) return "6GHz";
        if (frequency >= 4900) return "5GHz";
        return "2.4GHz";
    }

    private static String securityType(String caps) {
        String value = caps == null ? "" : caps.toUpperCase(Locale.US);
        if (value.contains("WEP")) return "WEP";
        if (value.contains("SAE") || value.contains("OWE")) return "WPA3";
        if (value.contains("PSK") || value.contains("EAP") || value.contains("WPA")) return value.contains("WPA") ? "WPA2" : "WPA";
        return value.isEmpty() ? "Unknown" : "Open";
    }

    private static String wifiStandard(ScanResult result) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            switch (result.getWifiStandard()) {
                case ScanResult.WIFI_STANDARD_11BE: return "Wi-Fi 7 (802.11be)";
                case ScanResult.WIFI_STANDARD_11AX: return "Wi-Fi 6 (802.11ax)";
                case ScanResult.WIFI_STANDARD_11AC: return "Wi-Fi 5 (802.11ac)";
                case ScanResult.WIFI_STANDARD_11N: return "Wi-Fi 4 (802.11n)";
                default: return "Wi-Fi (Legacy)";
            }
        }
        return "Wi-Fi (Legacy)";
    }

    private static String wifiStandard(WifiInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            switch (info.getWifiStandard()) {
                case ScanResult.WIFI_STANDARD_11BE: return "Wi-Fi 7 (802.11be)";
                case ScanResult.WIFI_STANDARD_11AX: return "Wi-Fi 6 (802.11ax)";
                case ScanResult.WIFI_STANDARD_11AC: return "Wi-Fi 5 (802.11ac)";
                case ScanResult.WIFI_STANDARD_11N: return "Wi-Fi 4 (802.11n)";
                default: return "Wi-Fi (Legacy)";
            }
        }
        return "Wi-Fi (Legacy)";
    }

    private static int channelWidthFromWifiInfo(WifiInfo info) {
        return 0; // Android does not expose the current channel width consistently for WifiInfo.
    }

    private static String cleanSsid(String raw) {
        if (raw == null || "<unknown ssid>".equalsIgnoreCase(raw)) return "";
        return raw.replace("\"", "");
    }

    private static boolean validValue(String value) {
        return value != null && !value.isEmpty() && !"02:00:00:00:00:00".equalsIgnoreCase(value) && !"<unknown ssid>".equalsIgnoreCase(value);
    }

    private static String intToIpv4(int value) {
        return (value & 0xff) + "." + ((value >> 8) & 0xff) + "." + ((value >> 16) & 0xff) + "." + ((value >> 24) & 0xff);
    }

    private static long ipToLong(String ip) {
        String[] p = ip.split("\\.");
        if (p.length != 4) throw new IllegalArgumentException("Invalid IPv4 address: " + ip);
        return ((Long.parseLong(p[0]) & 255) << 24) | ((Long.parseLong(p[1]) & 255) << 16) | ((Long.parseLong(p[2]) & 255) << 8) | (Long.parseLong(p[3]) & 255);
    }

    private static String ipFromLong(long value) {
        return ((value >> 24) & 255) + "." + ((value >> 16) & 255) + "." + ((value >> 8) & 255) + "." + (value & 255);
    }

    private static long safeLongIp(String ip) { try { return ipToLong(ip); } catch (Exception ex) { return 0; } }
    private static double round1(double value) { return Math.round(value * 10.0) / 10.0; }

    private static String serviceName(int port) {
        switch (port) {
            case 21: return "FTP"; case 22: return "SSH"; case 25: return "SMTP"; case 53: return "DNS";
            case 80: return "HTTP"; case 139: return "NetBIOS"; case 443: return "HTTPS"; case 445: return "SMB";
            case 554: return "RTSP"; case 8008: return "Google Cast / HTTP"; case 8080: return "HTTP Alternate";
            case 8443: return "HTTPS Alternate"; case 9100: return "RAW Print"; case 3389: return "RDP";
            default: return "TCP " + port;
        }
    }

    private static String classifyDevice(List<Integer> ports, boolean gateway) {
        if (gateway) return "router";
        if (ports.contains(9100)) return "printer";
        if (ports.contains(554)) return "camera";
        if (ports.contains(8008)) return "tv";
        if (ports.contains(445) || ports.contains(3389) || ports.contains(22)) return "pc";
        return "other";
    }

    private static String classifyDeviceLabel(List<Integer> ports, boolean gateway) {
        String category = classifyDevice(ports, gateway);
        switch (category) {
            case "router": return "Шлюз"; case "printer": return "Принтер"; case "camera": return "Камера / RTSP";
            case "tv": return "Медиа-устройство"; case "pc": return "Компьютер / сервер"; default: return "Сетевое устройство";
        }
    }
}
