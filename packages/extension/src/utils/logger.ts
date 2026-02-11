/**
 * Logging utility with timestamps
 * Provides consistent, timestamped logging for debugging
 */

/**
 * Log levels for filtering output
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry structure for storage
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

/**
 * Storage key for log entries
 */
const LOG_STORAGE_KEY = 'extensionLogs';

/**
 * Maximum number of log entries to keep in storage
 */
const MAX_LOG_ENTRIES = 100;

/**
 * Current log level (entries below this level are filtered out in production)
 */
const CURRENT_LOG_LEVEL: LogLevel = 'debug';

/**
 * Log level priority for filtering
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Format timestamp for logs
 */
function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const pad3 = (n: number) => n.toString().padStart(3, '0');
  
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
}

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL];
}

/**
 * Store a log entry to chrome.storage.local (for error persistence)
 */
async function storeLogEntry(entry: LogEntry): Promise<void> {
  // Only store warnings and errors
  if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY['warn']) {
    return;
  }

  try {
    const result = await chrome.storage.local.get(LOG_STORAGE_KEY);
    const logs: LogEntry[] = result[LOG_STORAGE_KEY] || [];
    
    // Add new entry
    logs.push(entry);
    
    // Keep only the last MAX_LOG_ENTRIES entries
    const trimmedLogs = logs.slice(-MAX_LOG_ENTRIES);
    
    await chrome.storage.local.set({ [LOG_STORAGE_KEY]: trimmedLogs });
  } catch {
    // Silently fail if storage is not available
  }
}

/**
 * Create a logger instance for a specific module
 */
export function createLogger(module: string) {
  const formatMessage = (level: LogLevel, message: string, data?: unknown): string => {
    const timestamp = formatTimestamp();
    const levelUpper = level.toUpperCase().padEnd(5);
    const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${levelUpper}] [${module}] ${message}${dataStr}`;
  };

  const log = (level: LogLevel, message: string, data?: unknown): void => {
    if (!shouldLog(level)) {
      return;
    }

    const formattedMessage = formatMessage(level, message, data);
    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      level,
      module,
      message,
      data,
    };

    // Output to console
    switch (level) {
      case 'debug':
        console.log(formattedMessage);
        break;
      case 'info':
        console.info(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      case 'error':
        console.error(formattedMessage);
        break;
    }

    // Store warnings and errors
    storeLogEntry(entry).catch(() => {});
  };

  return {
    /**
     * Log a debug message
     */
    debug: (message: string, data?: unknown) => log('debug', message, data),

    /**
     * Log an info message
     */
    info: (message: string, data?: unknown) => log('info', message, data),

    /**
     * Log a warning message
     */
    warn: (message: string, data?: unknown) => log('warn', message, data),

    /**
     * Log an error message
     */
    error: (message: string, data?: unknown) => log('error', message, data),

    /**
     * Log an error with Error object details
     */
    errorWithStack: (message: string, error: unknown) => {
      const errorData = error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { error };
      log('error', message, errorData);
    },
  };
}

/**
 * Get stored log entries
 */
export async function getStoredLogs(): Promise<LogEntry[]> {
  try {
    const result = await chrome.storage.local.get(LOG_STORAGE_KEY);
    return result[LOG_STORAGE_KEY] || [];
  } catch {
    return [];
  }
}

/**
 * Clear stored log entries
 */
export async function clearStoredLogs(): Promise<void> {
  try {
    await chrome.storage.local.remove(LOG_STORAGE_KEY);
  } catch {
    // Silently fail
  }
}

/**
 * Get recent error logs (for displaying in UI)
 */
export async function getRecentErrors(count: number = 5): Promise<LogEntry[]> {
  const logs = await getStoredLogs();
  return logs
    .filter(log => log.level === 'error')
    .slice(-count);
}

// Pre-created loggers for common modules
export const backgroundLogger = createLogger('Background');
export const zoomApiLogger = createLogger('ZoomAPI');
export const zoomAuthLogger = createLogger('ZoomAuth');
export const popupLogger = createLogger('Popup');
export const contentLogger = createLogger('Content');
