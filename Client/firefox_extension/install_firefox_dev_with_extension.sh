#!/bin/bash

set -e

### === KONFIGURATION ===

FIREFOX_VERSION="134.0b9"
INSTALL_DIR="/opt/firefox-dev"
PROFILE_NAME="bsync-profile"
EXTENSION_ZIP="/home/user/Downloads/bsync/Client/firefox_extension/firefox_extension.zip"
EXTENSION_ID="web-content-handler@example.com"

### === 1. Firefox Developer herunterladen ===

echo "🟣 Firefox Developer 134.0b9 herunterladen..."
cd /tmp
wget -O firefox-dev.tar.bz2 "https://ftp.mozilla.org/pub/devedition/releases/134.0b9/linux-x86_64/de/firefox-134.0b9.tar.bz2"

sudo mkdir -p "$INSTALL_DIR"
sudo tar -xjf firefox-dev.tar.bz2 -C "$INSTALL_DIR" --strip-components=1
sudo ln -sf "$INSTALL_DIR/firefox" /usr/local/bin/firefox-dev

### === 2. Firefox-Profil erstellen ===

echo "🔧 Neues Firefox-Profil erstellen..."
firefox-dev -CreateProfile "$PROFILE_NAME" > /dev/null
PROFILE_PATH=$(find ~/.mozilla/firefox -maxdepth 1 -type d -name "*.$PROFILE_NAME")

if [ ! -d "$PROFILE_PATH" ]; then
  echo "❌ Fehler: Profil konnte nicht erstellt werden!"
  exit 1
fi

### === 3. Erweiterung entpacken ===

echo "📦 Erweiterung entpacken..."
EXTENSION_DIR="$PROFILE_PATH/extensions/$EXTENSION_ID"
mkdir -p "$EXTENSION_DIR"
unzip -o "$EXTENSION_ZIP" -d "$EXTENSION_DIR"

### === 4. Signaturprüfung deaktivieren ===

echo "🚫 Signaturprüfung deaktivieren..."
USER_JS="$PROFILE_PATH/user.js"

cat <<EOF >> "$USER_JS"
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.install.requireBuiltInCerts", false);
user_pref("devtools.debugger.remote-enabled", true);
EOF

### === 5. Startbefehl anzeigen ===

echo "✅ Installation abgeschlossen."
echo "🔄 Starte Firefox Developer mit:"
echo ""
echo "    firefox-dev -no-remote -P \"$PROFILE_NAME\""
echo ""
