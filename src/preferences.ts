import type { ThemeName } from './theme'

export type AgentProvider = 'codex' | 'claude'

export interface OfficePreferences {
  bossName: string
  provider: AgentProvider
  assistantName: string
  theme: ThemeName
}

const STORAGE_KEY = 'agent-office.preferences.v1'

export const DEFAULT_PREFERENCES: OfficePreferences = {
  bossName: 'Boss',
  provider: 'codex',
  assistantName: 'Codex',
  theme: 'default',
}

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().slice(0, 32)
  if (!trimmed || trimmed.toLowerCase() === 'yourname') return fallback
  return trimmed
}

export function hasSavedPreferences(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

export function loadPreferences(): OfficePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES }

    const parsed = JSON.parse(raw) as Partial<OfficePreferences>
    const provider: AgentProvider = parsed.provider === 'claude' ? 'claude' : 'codex'
    const providerDefaultName = provider === 'codex' ? 'Codex' : 'Claude'

    return {
      bossName: cleanName(parsed.bossName, DEFAULT_PREFERENCES.bossName),
      provider,
      assistantName: cleanName(parsed.assistantName, providerDefaultName),
      theme: parsed.theme === 'office' ? 'office' : 'default',
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function savePreferences(preferences: OfficePreferences): OfficePreferences {
  const provider: AgentProvider = preferences.provider === 'claude' ? 'claude' : 'codex'
  const normalized: OfficePreferences = {
    bossName: cleanName(preferences.bossName, DEFAULT_PREFERENCES.bossName),
    provider,
    assistantName: cleanName(
      preferences.assistantName,
      provider === 'codex' ? 'Codex' : 'Claude',
    ),
    theme: preferences.theme === 'office' ? 'office' : 'default',
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // Preferences remain valid for the current session even if persistence fails.
  }

  return normalized
}
