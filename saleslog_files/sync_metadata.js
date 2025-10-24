/**
 * Sync Metadata Management Module
 * Centralized utility for tracking bidirectional synchronization metadata
 * 
 * This module provides functions for managing sync metadata stored in Properties Service.
 * It tracks when salespeople are modified (via sheet or sidebar), enables conflict detection,
 * and implements automatic cleanup to stay within Properties Service size limits.
 * 
 * Key Features:
 * - Tracks last modification time, user, and source (sheet/sidebar) for each salesperson
 * - Implements 30-day retention policy with automatic cleanup
 * - Enforces 8KB size limit with warning at 6KB (75% threshold)
 * - Version tracking for each salesperson entry
 * - Conflict statistics tracking
 * 
 * Storage Structure:
 * {
 *   "John Doe": {
 *     lastModified: "2025-01-24T02:10:00.000Z",
 *     modifiedBy: "user@example.com",
 *     source: "sheet" | "sidebar",
 *     version: 1
 *   },
 *   "_stats": {
 *     conflicts: 5,
 *     lastConflict: "2025-01-24T02:10:00.000Z"
 *   }
 * }
 * 
 * Note: In Google Apps Script, all .gs files share global scope, so no imports are needed.
 */

// Metadata storage key in Properties Service
const SYNC_METADATA_KEY = 'SALES_LOG_SYNC_META';

/**
 * Gets all sync metadata from Properties Service
 * Returns empty object if no metadata exists
 *
 * @returns {Object} Sync metadata structure mapping fullName to metadata objects
 */
function getSyncMetadataFromProperties() {
  try {
    const props = PropertiesService.getDocumentProperties();
    const metadataJson = props.getProperty(SYNC_METADATA_KEY);
    
    if (metadataJson) {
      return JSON.parse(metadataJson);
    } else {
      return {}; // Empty metadata
    }
  } catch (error) {
    logWarning('getSyncMetadataFromProperties', 'Error reading sync metadata', { error: error.toString() });
    return {};
  }
}

/**
 * Cleans up old sync metadata entries to reduce size.
 * Removes entries older than 30 days and orphaned entries.
 *
 * @param {Object} metadata - Current metadata object
 * @returns {Object} Cleaned metadata object
 */
function cleanupOldMetadata(metadata) {
  try {
    const RETENTION_DAYS = 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffTime = cutoffDate.getTime();
    
    const cleaned = {};
    let removedCount = 0;
    let keptCount = 0;
    
    // Preserve _stats if it exists
    if (metadata._stats) {
      cleaned._stats = metadata._stats;
    }
    
    // Filter metadata entries
    for (const key in metadata) {
      if (!metadata.hasOwnProperty(key)) continue;
      
      // Skip special keys
      if (key === '_stats') continue;
      
      const value = metadata[key];
      
      // Check if entry has lastModified timestamp
      if (value && value.lastModified) {
        const entryTime = new Date(value.lastModified).getTime();
        
        // Keep if within retention period
        if (entryTime >= cutoffTime) {
          cleaned[key] = value;
          keptCount++;
        } else {
          removedCount++;
        }
      } else {
        // Keep entries without timestamp (shouldn't happen, but defensive)
        cleaned[key] = value;
        keptCount++;
      }
    }
    
    Logger.log('[cleanupOldMetadata] Removed ' + removedCount + ' old entries, kept ' + keptCount + ' entries');
    
    return cleaned;
    
  } catch (error) {
    logWarning('cleanupOldMetadata', 'Error during cleanup', { error: error.toString() });
    // Return original metadata if cleanup fails
    return metadata;
  }
}

/**
 * Saves sync metadata to Properties Service with size validation.
 * Performs automatic cleanup of old metadata if size limit is approached.
 *
 * @param {Object} metadata - Sync metadata structure to save
 * @throws {Error} If metadata exceeds size limits even after cleanup
 */
function saveSyncMetadata(metadata) {
  try {
    const props = PropertiesService.getDocumentProperties();
    
    // Convert to JSON for size checking
    let metadataJson = JSON.stringify(metadata);
    let metadataSize = metadataJson.length;
    
    // Size validation: 8KB threshold (9KB hard limit with safety margin)
    const SIZE_LIMIT = 8192;  // 8KB in bytes
    const SIZE_WARNING = 6144; // 6KB (75% of limit)
    
    // If approaching or exceeding limit, attempt cleanup
    if (metadataSize >= SIZE_WARNING) {
      Logger.log('[saveSyncMetadata] Metadata size: ' + metadataSize + ' bytes (' + (metadataSize/1024).toFixed(2) + ' KB)');
      
      if (metadataSize >= SIZE_LIMIT) {
        // Attempt automatic cleanup
        Logger.log('[saveSyncMetadata] Size limit reached. Attempting cleanup...');
        metadata = cleanupOldMetadata(metadata);
        metadataJson = JSON.stringify(metadata);
        metadataSize = metadataJson.length;
        
        // If still too large after cleanup, throw error
        if (metadataSize >= SIZE_LIMIT) {
          throw new Error(
            'Sync metadata exceeds size limit: ' + metadataSize + ' bytes (max: ' + SIZE_LIMIT + '). ' +
            'Consider reducing retention period or implementing chunking.'
          );
        }
        
        Logger.log('[saveSyncMetadata] After cleanup: ' + metadataSize + ' bytes (' + (metadataSize/1024).toFixed(2) + ' KB)');
      } else {
        // Warning level - log but continue
        logWarning('saveSyncMetadata', 'Approaching size limit', {
          currentSize: metadataSize,
          limit: SIZE_LIMIT,
          percentUsed: ((metadataSize / SIZE_LIMIT) * 100).toFixed(1) + '%'
        });
      }
    }
    
    // Write to Properties Service
    props.setProperty(SYNC_METADATA_KEY, metadataJson);
    
    // Log successful write with size info
    if (metadataSize >= SIZE_WARNING) {
      Logger.log('[saveSyncMetadata] Successfully saved metadata (' + metadataSize + ' bytes)');
    }
    
  } catch (error) {
    logError('saveSyncMetadata', error, {
      operation: 'properties_write',
      attemptedSize: metadataJson ? metadataJson.length : 'unknown'
    });
    throw error;
  }
}

/**
 * Creates or updates sync metadata for tracking
 * Tracks when and by whom a salesperson was last modified
 * 
 * @param {string} fullName - Salesperson full name
 * @param {string} source - 'sheet' or 'sidebar'
 */
function updateSyncMetadata(fullName, source) {
  try {
    const metadata = getSyncMetadataFromProperties();
    
    // Create or update entry for this salesperson
    metadata[fullName] = {
      lastModified: new Date().toISOString(),
      modifiedBy: getSafeUserEmail(),
      source: source,
      version: (metadata[fullName] && metadata[fullName].version) ? metadata[fullName].version + 1 : 1
    };
    
    // Save back to Properties
    saveSyncMetadata(metadata);
    
    Logger.log('[Sync] Updated metadata for ' + fullName + ' (source: ' + source + ')');
    
  } catch (error) {
    logWarning('updateSyncMetadata', 'Error updating sync metadata', { error: error.toString(), fullName });
    // Don't throw - metadata tracking failure shouldn't break sync
  }
}