/**
 * Chrome storage helper utilities
 * Provides type-safe wrappers around chrome.storage.local
 */

import type { MeetingState, ExtensionSettings } from '../types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../types';

/**
 * Get a value from chrome.storage.local
 */
async function get<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

/**
 * Set a value in chrome.storage.local
 */
async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/**
 * Remove a value from chrome.storage.local
 */
async function remove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

/**
 * Clear all values from chrome.storage.local
 */
export async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();
}

// ============================================
// Meeting State Storage
// ============================================

/**
 * Get stored meeting state
 */
export async function getMeetingState(): Promise<MeetingState | null> {
  return get<MeetingState>(STORAGE_KEYS.MEETING_STATE);
}

/**
 * Save meeting state
 */
export async function saveMeetingState(state: MeetingState): Promise<void> {
  await set(STORAGE_KEYS.MEETING_STATE, state);
}

/**
 * Clear meeting state
 */
export async function clearMeetingState(): Promise<void> {
  await remove(STORAGE_KEYS.MEETING_STATE);
}

// ============================================
// Extension Settings Storage
// ============================================

/**
 * Get extension settings (with defaults)
 */
export async function getSettings(): Promise<ExtensionSettings> {
  const settings = await get<ExtensionSettings>(STORAGE_KEYS.SETTINGS);
  return settings ?? DEFAULT_SETTINGS;
}

/**
 * Save extension settings
 */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await set(STORAGE_KEYS.SETTINGS, settings);
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  await set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
}

// ============================================
// Storage Event Listener
// ============================================

export type StorageChangeCallback = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
) => void;

/**
 * Listen for storage changes
 */
export function onStorageChange(callback: StorageChangeCallback): void {
  chrome.storage.onChanged.addListener(callback);
}

/**
 * Remove storage change listener
 */
export function removeStorageChangeListener(callback: StorageChangeCallback): void {
  chrome.storage.onChanged.removeListener(callback);
}
