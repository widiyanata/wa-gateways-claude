/**
 * Cache Manager for AI responses
 * Provides in-memory and file-based caching for AI responses to reduce API calls
 */

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

// Constants
// const CACHE_DIR = path.join(process.cwd(), "cache");
const CACHE_DIR = path.join('/tmp', "cache");
const DEFAULT_MEMORY_CACHE_SIZE = 100; // Number of items to keep in memory cache
const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// In-memory cache
let memoryCache = new Map();
let memoryCacheKeys = []; // To track order for LRU eviction

/**
 * Initialize the cache system
 * @returns {Promise<void>}
 */
const initializeCache = async () => {
  try {
    // Ensure cache directory exists
    await fs.ensureDir(CACHE_DIR);

    // Clear expired items from file cache on startup
    await clearExpiredCache();

    console.log("Cache system initialized");
  } catch (error) {
    console.error(`Failed to initialize cache: ${error.message}`);
  }
};

/**
 * Generate a cache key from messages and configuration
 * @param {Array} messages - The conversation messages
 * @param {Object} config - The AI configuration
 * @returns {string} The cache key
 */
const generateCacheKey = (messages, config) => {
  // Create a string representation of the request
  const requestString = JSON.stringify({
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    model: config.model,
    provider: config.provider,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  });

  // Create a hash of the request string
  return crypto.createHash("md5").update(requestString).digest("hex");
};

/**
 * Get an item from cache
 * @param {string} key - The cache key
 * @param {Object} cacheConfig - Cache configuration
 * @returns {Promise<Object|null>} The cached item or null if not found
 */
const getCacheItem = async (key, cacheConfig) => {
  try {
    // Check if caching is enabled
    if (!cacheConfig.enabled) {
      return null;
    }

    // Check memory cache first
    if (cacheConfig.useMemoryCache && memoryCache.has(key)) {
      const item = memoryCache.get(key);

      // Check if item is expired
      if (item.expiresAt && item.expiresAt < Date.now()) {
        // Remove expired item
        memoryCache.delete(key);
        memoryCacheKeys = memoryCacheKeys.filter((k) => k !== key);
        return null;
      }

      // Update item position in LRU list
      memoryCacheKeys = memoryCacheKeys.filter((k) => k !== key);
      memoryCacheKeys.push(key);

      console.log(`Cache hit (memory): ${key}`);
      return item.data;
    }

    // Check file cache if enabled
    if (cacheConfig.useFileCache) {
      const cacheFilePath = path.join(CACHE_DIR, `${key}.json`);

      if (await fs.pathExists(cacheFilePath)) {
        const cacheFile = await fs.readJson(cacheFilePath);

        // Check if file cache is expired
        if (cacheFile.expiresAt && cacheFile.expiresAt < Date.now()) {
          // Remove expired cache file
          await fs.remove(cacheFilePath);
          return null;
        }

        // If memory cache is enabled, also add to memory
        if (cacheConfig.useMemoryCache) {
          setCacheItemMemory(key, cacheFile.data, cacheFile.expiresAt, cacheConfig);
        }

        console.log(`Cache hit (file): ${key}`);
        return cacheFile.data;
      }
    }

    // Not found in any cache
    return null;
  } catch (error) {
    console.error(`Error getting cache item: ${error.message}`);
    return null; // Return null on error to proceed with normal API call
  }
};

/**
 * Set an item in memory cache
 * @param {string} key - The cache key
 * @param {Object} data - The data to cache
 * @param {number} expiresAt - Expiration timestamp
 * @param {Object} cacheConfig - Cache configuration
 */
const setCacheItemMemory = (key, data, expiresAt, cacheConfig) => {
  // Add to memory cache
  memoryCache.set(key, {
    data,
    expiresAt,
    createdAt: Date.now(),
  });

  // Add to keys list for LRU tracking
  memoryCacheKeys = memoryCacheKeys.filter((k) => k !== key);
  memoryCacheKeys.push(key);

  // Check if we need to evict items (LRU)
  const maxSize = cacheConfig.memoryCacheSize || DEFAULT_MEMORY_CACHE_SIZE;
  while (memoryCache.size > maxSize) {
    const oldestKey = memoryCacheKeys.shift();
    memoryCache.delete(oldestKey);
    console.log(`Cache evicted (LRU): ${oldestKey}`);
  }
};

/**
 * Set an item in cache
 * @param {string} key - The cache key
 * @param {Object} data - The data to cache
 * @param {Object} cacheConfig - Cache configuration
 * @returns {Promise<void>}
 */
const setCacheItem = async (key, data, cacheConfig) => {
  try {
    // Check if caching is enabled
    if (!cacheConfig.enabled) {
      return;
    }

    // Calculate expiration time
    const ttl = cacheConfig.ttl || DEFAULT_CACHE_TTL;
    const expiresAt = Date.now() + ttl;

    // Set in memory cache if enabled
    if (cacheConfig.useMemoryCache) {
      setCacheItemMemory(key, data, expiresAt, cacheConfig);
    }

    // Set in file cache if enabled
    if (cacheConfig.useFileCache) {
      const cacheFilePath = path.join(CACHE_DIR, `${key}.json`);

      await fs.writeJson(
        cacheFilePath,
        {
          data,
          expiresAt,
          createdAt: Date.now(),
        },
        { spaces: 2 }
      );
    }

    console.log(`Cache set: ${key}`);
  } catch (error) {
    console.error(`Error setting cache item: ${error.message}`);
    // Continue without caching on error
  }
};

/**
 * Clear expired items from file cache
 * @returns {Promise<void>}
 */
const clearExpiredCache = async () => {
  try {
    // Ensure cache directory exists
    await fs.ensureDir(CACHE_DIR);

    // Get all cache files
    const files = await fs.readdir(CACHE_DIR);

    let cleared = 0;
    const now = Date.now();

    // Check each file
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(CACHE_DIR, file);

        try {
          const cacheFile = await fs.readJson(filePath);

          // Check if expired
          if (cacheFile.expiresAt && cacheFile.expiresAt < now) {
            await fs.remove(filePath);
            cleared++;
          }
        } catch (fileError) {
          // If file is corrupted, remove it
          await fs.remove(filePath);
          cleared++;
        }
      }
    }

    if (cleared > 0) {
      console.log(`Cleared ${cleared} expired cache items`);
    }
  } catch (error) {
    console.error(`Error clearing expired cache: ${error.message}`);
  }
};

/**
 * Clear all cache items
 * @returns {Promise<void>}
 */
const clearAllCache = async () => {
  try {
    // Clear memory cache
    memoryCache.clear();
    memoryCacheKeys = [];

    // Clear file cache
    await fs.emptyDir(CACHE_DIR);

    console.log("Cache cleared");
  } catch (error) {
    console.error(`Error clearing cache: ${error.message}`);
    throw error;
  }
};

/**
 * Get cache statistics
 * @returns {Promise<Object>} Cache statistics
 */
const getCacheStats = async () => {
  try {
    // Get file cache stats
    const files = await fs.readdir(CACHE_DIR);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    // Calculate total size of cache files
    let totalSize = 0;
    for (const file of jsonFiles) {
      const stats = await fs.stat(path.join(CACHE_DIR, file));
      totalSize += stats.size;
    }

    return {
      memoryCacheSize: memoryCache.size,
      memoryCacheKeys: memoryCacheKeys.length,
      fileCacheSize: jsonFiles.length,
      fileCacheSizeBytes: totalSize,
      fileCacheSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
    };
  } catch (error) {
    console.error(`Error getting cache stats: ${error.message}`);
    return {
      error: error.message,
    };
  }
};

// Initialize cache on module load
initializeCache().catch(console.error);

module.exports = {
  generateCacheKey,
  getCacheItem,
  setCacheItem,
  clearExpiredCache,
  clearAllCache,
  getCacheStats,
};
