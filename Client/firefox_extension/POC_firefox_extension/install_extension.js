/**
 * Hilfsskript zur Installation der Firefox-Erweiterung in Firefox Developer Edition
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Konfiguration
const isWindows = process.platform === 'win32';
const FIREFOX_PATH = isWindows 
  ? "C:\\Program Files\\Firefox Developer Edition\\firefox.exe" 
  : "/opt/firefox-dev/firefox";
const PROFILE_NAME = "bsync-profile";
const EXTENSION_PATH = path.join(__dirname, 'extension');

console.log('Firefox-Erweiterung Installations-Helfer');
console.log('=======================================');
console.log(`Firefox Pfad: ${FIREFOX_PATH}`);
console.log(`Profil: ${PROFILE_NAME}`);
console.log(`Erweiterungspfad: ${EXTENSION_PATH}`);

// Prüfe, ob Firefox existiert
if (!fs.existsSync(FIREFOX_PATH)) {
  console.error(`Fehler: Firefox konnte nicht unter ${FIREFOX_PATH} gefunden werden.`);
  console.log('Bitte installieren Sie Firefox Developer Edition oder passen Sie den Pfad an.');
  process.exit(1);
}

// Erstelle das Firefox-Profil, falls es nicht existiert
function createProfileIfNeeded() {
  try {
    console.log(`\nPrüfe/erstelle Firefox-Profil: ${PROFILE_NAME}`);
    const command = `"${FIREFOX_PATH}" -CreateProfile "${PROFILE_NAME}"`;
    console.log(`Führe aus: ${command}`);
    execSync(command, { stdio: 'inherit' });
    console.log('Profil erstellt oder existiert bereits');
    return true;
  } catch (error) {
    console.error('Fehler beim Erstellen des Firefox-Profils:', error.message);
    return false;
  }
}

// Finde den Profilpfad
function findProfilePath() {
  let profilesIniPath;

  if (isWindows) {
    const appData = process.env.APPDATA;
    profilesIniPath = path.join(appData, 'Mozilla', 'Firefox', 'profiles.ini');
  } else if (process.platform === 'darwin') {
    // macOS
    const homeDir = process.env.HOME;
    profilesIniPath = path.join(homeDir, 'Library', 'Application Support', 'Firefox', 'profiles.ini');
  } else {
    // Linux und andere
    const homeDir = process.env.HOME;
    profilesIniPath = path.join(homeDir, '.mozilla', 'firefox', 'profiles.ini');
  }

  console.log(`\nSuche nach profiles.ini: ${profilesIniPath}`);
  
  if (!fs.existsSync(profilesIniPath)) {
    console.error('Fehler: profiles.ini konnte nicht gefunden werden');
    return null;
  }

  const content = fs.readFileSync(profilesIniPath, 'utf8');
  const lines = content.split('\n');
  
  let profileDir = null;
  let inProfileSection = false;
  let currentName = null;
  
  for (const line of lines) {
    if (line.startsWith('[Profile')) {
      inProfileSection = true;
      currentName = null;
    } else if (inProfileSection && line.startsWith('Name=')) {
      currentName = line.substring(5).trim();
    } else if (inProfileSection && line.startsWith('Path=') && currentName === PROFILE_NAME) {
      profileDir = line.substring(5).trim();
      break;
    }
  }
  
  if (!profileDir) {
    console.error(`Fehler: Profil "${PROFILE_NAME}" konnte nicht gefunden werden`);
    return null;
  }
  
  let profilePath;
  if (profileDir.startsWith('/')) {
    profilePath = profileDir;
  } else {
    // Relativer Pfad
    profilePath = path.join(path.dirname(profilesIniPath), profileDir);
  }
  
  console.log(`Profilpfad gefunden: ${profilePath}`);
  return profilePath;
}

// Installiere die Erweiterung im Profil
function installExtension(profilePath) {
  console.log('\nInstalliere die Erweiterung...');
  
  if (!profilePath) {
    console.error('Fehler: Kein Profilpfad angegeben');
    return false;
  }
  
  const extensionsDir = path.join(profilePath, 'extensions');
  
  // Erstelle extensions-Verzeichnis, falls es nicht existiert
  if (!fs.existsSync(extensionsDir)) {
    console.log(`Erstelle extensions-Verzeichnis: ${extensionsDir}`);
    fs.mkdirSync(extensionsDir, { recursive: true });
  }
  
  // Lese die Erweiterungs-ID aus manifest.json
  const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const extensionId = manifest.browser_specific_settings?.gecko?.id;
  
  if (!extensionId) {
    console.error('Fehler: Keine Erweiterungs-ID in manifest.json gefunden');
    return false;
  }
  
  // Erstelle den Symlink oder kopiere die Erweiterung
  const targetPath = path.join(extensionsDir, `${extensionId}`);
  
  if (fs.existsSync(targetPath)) {
    console.log(`Lösche existierende Erweiterung: ${targetPath}`);
    if (isWindows) {
      execSync(`rmdir /S /Q "${targetPath}"`, { stdio: 'inherit' });
    } else {
      execSync(`rm -rf "${targetPath}"`, { stdio: 'inherit' });
    }
  }
  
  // Kopiere die Erweiterung
  console.log(`Kopiere Erweiterung nach: ${targetPath}`);
  if (isWindows) {
    execSync(`mkdir "${targetPath}"`, { stdio: 'inherit' });
    execSync(`xcopy "${EXTENSION_PATH}\\*" "${targetPath}\\" /E /I /Y`, { stdio: 'inherit' });
  } else {
    execSync(`mkdir -p "${targetPath}"`, { stdio: 'inherit' });
    execSync(`cp -R "${EXTENSION_PATH}/"* "${targetPath}/"`, { stdio: 'inherit' });
  }
  
  console.log('Erweiterung erfolgreich installiert');
  return true;
}

// Hauptprozess
(async () => {
  if (createProfileIfNeeded()) {
    // Warte kurz, damit Firefox das Profil erstellen kann
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const profilePath = findProfilePath();
    if (profilePath) {
      installExtension(profilePath);
      console.log('\nInstallation abgeschlossen. Sie können nun launcher.js ausführen.');
    }
  }
})(); 