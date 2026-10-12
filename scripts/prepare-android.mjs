import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const configPath = path.join(root, 'capacitor.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const appId = config.appId;
if (!appId || !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(appId)) {
  throw new Error(`Invalid capacitor appId: ${appId}`);
}
const androidRoot = path.join(root, 'android');
if (!fs.existsSync(androidRoot)) throw new Error('Android project missing. Run "npx cap add android" first.');

const javaPackagePath = appId.split('.').join(path.sep);
const javaDir = path.join(androidRoot, 'app', 'src', 'main', 'java', javaPackagePath);
fs.mkdirSync(javaDir, { recursive: true });
const pluginSource = fs.readFileSync(path.join(root, 'android-native', 'WifiToolsPlugin.java'), 'utf8')
  .replace(/^package\s+[\w.]+;/m, `package ${appId};`);
fs.writeFileSync(path.join(javaDir, 'WifiToolsPlugin.java'), pluginSource);

const mainActivity = path.join(javaDir, 'MainActivity.java');
if (!fs.existsSync(mainActivity)) {
  throw new Error(`Expected Capacitor MainActivity.java at ${mainActivity}`);
}
const mainActivitySource = `package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WifiToolsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;
fs.writeFileSync(mainActivity, mainActivitySource);

const manifestPath = path.join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
const permissions = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_WIFI_STATE',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.NEARBY_WIFI_DEVICES',
];
const missing = permissions.filter(permission => !manifest.includes(`android:name="${permission}"`));
if (missing.length) {
  const declarations = missing.map(permission => `    <uses-permission android:name="${permission}" />`).join('\n');
  manifest = manifest.replace(/<application\b/, `${declarations}\n\n    <application`);
}
manifest = manifest.replace(/<application\b([^>]*)>/, (match, attrs) => {
  if (/android:usesCleartextTraffic\s*=/.test(attrs)) return match.replace(/android:usesCleartextTraffic\s*=\s*"[^"]*"/, 'android:usesCleartextTraffic="true"');
  return `<application${attrs} android:usesCleartextTraffic="true">`;
});
fs.writeFileSync(manifestPath, manifest);
console.log(`Prepared native WifiTools plugin for ${appId}`);
