/**
 * Firefox Profile Manager
 * 
 * This module handles creation and management of Firefox profiles for the BSYNC extension.
 * It includes functions for creating temporary profiles, configuring proxy settings,
 * and cleaning up profile directories.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultPreferences } = require('./firefox_prefs'); // Import from the new file

// Global variable to track the temporary profile directory
let tempProfileDir = null;
let profileCreated = false;

/**
 * Creates a Firefox profile manually without using -CreateProfile
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.extensionPath - Path to the extension directory
 * @param {boolean} options.enableProxy - Whether to enable proxy
 * @param {string} options.proxyHost - Proxy host address
 * @param {number} options.proxyPort - Proxy port number
 * @returns {Object|null} Profile information or null if creation failed
 */
function createFirefoxProfile(options) {
  try {
    // Create temporary directory for the profile
    const profileDir = path.join(os.tmpdir(), `firefox_profile_${Date.now()}`);
    console.log(`Creating profile directory at: ${profileDir}`);
    
    fs.mkdirSync(profileDir, { recursive: true });
    
    // Write preferences to user.js file
    const preferencesContent = getDefaultPreferences(options);
    fs.writeFileSync(path.join(profileDir, 'user.js'), preferencesContent);
    
    // Create basic prefs.js file
    fs.writeFileSync(path.join(profileDir, 'prefs.js'), preferencesContent);
    
    // Create empty times.json
    fs.writeFileSync(path.join(profileDir, 'times.json'), '{}');
    
    // Create extensions directory within the profile
    const extensionsDir = path.join(profileDir, 'extensions');
    fs.mkdirSync(extensionsDir, { recursive: true });
    
    // Read extension ID from manifest.json
    const manifestPath = path.join(options.extensionPath, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const extensionId = manifest.browser_specific_settings?.gecko?.id;
    
    if (!extensionId) {
      console.error('Error: No extension ID found in manifest.json');
      return null;
    }
    
    // Create extension directory with ID as name
    const extensionTargetDir = path.join(extensionsDir, `${extensionId}.xpi`);
    
    // Copy extension files to the extensions directory
    copyDir(options.extensionPath, extensionsDir);
    
    profileCreated = true;
    tempProfileDir = profileDir;
    
    // Copy extension directly to extensions folder
    // Direct approach for extension installation
    fs.writeFileSync(
      path.join(extensionsDir, `${extensionId}`), 
      path.resolve(options.extensionPath)
    );
    
    return {
      profilePath: profileDir
    };
  } catch (error) {
    console.error('Error creating Firefox profile:', error);
    return null;
  }
}

/**
 * Helper function to recursively copy directory contents
 * 
 * @param {string} src - Source directory path
 * @param {string} dest - Destination directory path
 */
function copyDir(src, dest) {
  try {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  } catch (error) {
    console.error(`Error copying directory ${src} to ${dest}:`, error);
  }
}

/**
 * Configure Firefox proxy settings in the profile
 * 
 * @param {string} profileDir - Path to the Firefox profile directory
 * @param {string} proxyHost - Proxy host address
 * @param {number} proxyPort - Proxy port number
 * @returns {boolean} Success status
 */
function setupProxySettings(profileDir, proxyHost, proxyPort) {
  if (!proxyHost || !proxyPort) {
    console.log('No proxy settings provided, using direct connection');
    return false;
  }

  try {
    // Get proxy settings from default preferences
    const proxySettings = getDefaultPreferences({
      enableProxy: true,
      proxyHost,
      proxyPort
    });
    
    // Update user.js file with proxy settings
    const userJsPath = path.join(profileDir, 'user.js');
    fs.writeFileSync(userJsPath, proxySettings, 'utf8');
    
    console.log(`Proxy settings written to ${userJsPath}`);
    return true;
  } catch (error) {
    console.error('Error setting up proxy:', error);
    return false;
  }
}

/**
 * Clean up temporary profile directory
 * 
 * @returns {boolean} Success status
 */
function cleanupTempProfile() {
  if (tempProfileDir && fs.existsSync(tempProfileDir)) {
    try {
      console.log(`Removing temporary profile directory: ${tempProfileDir}`);
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error('Error removing temporary profile directory:', error);
      return false;
    }
  }
  return false;
}

/**
 * Get the current temporary profile directory path
 * 
 * @returns {string|null} Profile directory path or null if not created
 */
function getTempProfileDir() {
  return tempProfileDir;
}

/**
 * Check if a profile has been created
 * 
 * @returns {boolean} Profile creation status
 */
function isProfileCreated() {
  return profileCreated;
}

module.exports = {
  createFirefoxProfile,
  setupProxySettings,
  cleanupTempProfile,
  getTempProfileDir,
  isProfileCreated
}; 