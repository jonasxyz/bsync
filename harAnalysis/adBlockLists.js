const fs = require('fs');
const path = require('path');
const https = require('https');

const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt';
const CACHE_FILE = path.join(__dirname, 'easylist.cache.json');
const CACHE_DURATION = 4 * 24 * 60 * 60 * 1000; // 4 days in milliseconds

/**
 * Manages AdBlock lists by fetching and parsing EasyList.
 */
class AdBlockLists {
  constructor(options = {}) {
    this.options = {
      verbose: false,
      ...options
    };
    this.adPatterns = [];
    this.initialized = this.loadRules();
  }

  /**
   * Logs messages if verbose option is enabled.
   * @param {string} message 
   */
  log(message) {
    if (this.options.verbose) {
      console.log(`[AdBlockLists] ${message}`);
    }
  }

  /**
   * Loads rules from cache or fetches them from the EasyList URL.
   * @returns {Promise<void>}
   */
  async loadRules() {
    try {
      if (this.isCacheValid()) {
        this.log('Loading EasyList rules from cache...');
        const cachedData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        this.adPatterns = cachedData.patterns;
        return;
      }

      this.log('Fetching EasyList rules from source...');
      const listContent = await this.fetchEasyList();
      this.adPatterns = this.parseEasyList(listContent);
      this.cacheRules();
      this.log(`Successfully loaded and parsed ${this.adPatterns.length} ad patterns from EasyList.`);

    } catch (error) {
      console.error('Failed to load AdBlock rules:', error);
      // Fallback to empty list if fetching fails
      this.adPatterns = [];
    }
  }

  /**
   * Checks if the cached EasyList is still valid.
   * @returns {boolean}
   */
  isCacheValid() {
    if (!fs.existsSync(CACHE_FILE)) {
      return false;
    }
    const stats = fs.statSync(CACHE_FILE);
    return (Date.now() - stats.mtimeMs) < CACHE_DURATION;
  }

  /**
   * Fetches the EasyList content from the official URL.
   * @returns {Promise<string>}
   */
  fetchEasyList() {
    return new Promise((resolve, reject) => {
      https.get(EASYLIST_URL, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Failed to fetch EasyList, status code: ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve(data);
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Parses the raw EasyList content into a list of blockable patterns.
   * This is a simplified parser focusing on domain/URL patterns.
   * @param {string} content - The raw content of the EasyList file.
   * @returns {string[]}
   */
  parseEasyList(content) {
    const lines = content.split('\n');
    const patterns = [];

    for (const line of lines) {
      // Ignore comments, empty lines, and allowlist rules (starting with @@)
      if (line.startsWith('!') || line.startsWith('@@') || !line.trim()) {
        continue;
      }
      
      // Basic domain blocking rules (e.g., ||example.com^ or .example.com/)
      // This is a simplification and might not cover all EasyList syntax.
      let pattern = line;
      
      // Remove options ($... at the end)
      const optionsIndex = pattern.indexOf('$');
      if (optionsIndex !== -1) {
        pattern = pattern.substring(0, optionsIndex);
      }
      
      // Normalize common patterns
      if (pattern.startsWith('||')) {
        pattern = pattern.substring(2);
      }
      if (pattern.endsWith('^')) {
        pattern = pattern.substring(0, pattern.length - 1);
      }
      if (pattern.startsWith('.')) {
        pattern = pattern.substring(1);
      }
      if (pattern.endsWith('/')) {
        pattern = pattern.substring(0, pattern.length - 1);
      }

      // Add only if it's a valid-looking domain part
      if (pattern.includes('.') && pattern.length > 3) {
        patterns.push(pattern.trim());
      }
    }
    
    return patterns;
  }
  
  /**
   * Caches the loaded rules to a local file.
   */
  cacheRules() {
    try {
      const cacheData = {
        timestamp: Date.now(),
        patterns: this.adPatterns,
      };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      console.error('Failed to cache EasyList rules:', error);
    }
  }

  /**
   * Checks if a URL matches any of the loaded AdBlock patterns.
   * @param {string} url - The URL to check.
   * @returns {boolean} - True if the URL should be blocked.
   */
  shouldBlock(url) {
    if (!this.adPatterns.length) return false;

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      // Check against parsed patterns
      for (const pattern of this.adPatterns) {
        // Simple check if hostname or full URL contains the pattern
        if (hostname.includes(pattern) || url.includes(pattern)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      // Ignore invalid URLs
      return false;
    }
  }
}

module.exports = AdBlockLists;
