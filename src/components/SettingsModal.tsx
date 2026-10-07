import React, { useEffect, useState } from 'react'
import type { OfficePreferences, AgentProvider } from '../preferences'

interface SettingsModalProps {
  preferences: OfficePreferences
  firstRun?: boolean
  onSave: (preferences: OfficePreferences) => void
  onClose: () => void
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  preferences,
  firstRun = false,
  onSave,
  onClose,
}) => {
  const [draft, setDraft] = useState<OfficePreferences>(preferences)

  useEffect(() => {
    setDraft(preferences)
  }, [preferences])

  const setProvider = (provider: AgentProvider) => {
    setDraft(prev => {
      const oldDefault = prev.provider === 'codex' ? 'Codex' : 'Claude'
      const nextDefault = provider === 'codex' ? 'Codex' : 'Claude'
      return {
        ...prev,
        provider,
        assistantName:
          !prev.assistantName.trim() || prev.assistantName === oldDefault
            ? nextDefault
            : prev.assistantName,
      }
    })
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Agent Office settings">
        <div className="settings-header">
          <div>
            <div className="settings-title">{firstRun ? 'Welcome to Agent Office' : 'Settings'}</div>
            <div className="settings-subtitle">
              {firstRun ? 'Personalize the office before you start.' : 'Changes are saved on this Mac.'}
            </div>
          </div>
          {!firstRun && (
            <button className="settings-close" onClick={onClose} aria-label="Close settings">×</button>
          )}
        </div>

        <label className="settings-field">
          <span>Your name</span>
          <input
            value={draft.bossName}
            maxLength={32}
            autoFocus={firstRun}
            onChange={(event) => setDraft(prev => ({ ...prev, bossName: event.target.value }))}
            placeholder="Boss"
          />
        </label>

        <label className="settings-field">
          <span>Provider</span>
          <select
            value={draft.provider}
            onChange={(event) => setProvider(event.target.value as AgentProvider)}
          >
            <option value="codex">OpenAI Codex</option>
            <option value="claude">Claude Code</option>
          </select>
        </label>

        <label className="settings-field">
          <span>Assistant name</span>
          <input
            value={draft.assistantName}
            maxLength={32}
            onChange={(event) => setDraft(prev => ({ ...prev, assistantName: event.target.value }))}
            placeholder={draft.provider === 'codex' ? 'Codex' : 'Claude'}
          />
        </label>

        <label className="settings-field">
          <span>Theme</span>
          <select
            value={draft.theme}
            onChange={(event) =>
              setDraft(prev => ({
                ...prev,
                theme: event.target.value === 'office' ? 'office' : 'default',
              }))
            }
          >
            <option value="default">Agent Office</option>
            <option value="office">The Office</option>
          </select>
        </label>

        <div className="settings-preview">
          <span>Preview</span>
          <strong>{draft.bossName.trim() || 'Boss'}</strong>
          <span>+</span>
          <strong>{draft.assistantName.trim() || (draft.provider === 'codex' ? 'Codex' : 'Claude')}</strong>
        </div>

        <div className="settings-actions">
          {!firstRun && <button className="settings-secondary" onClick={onClose}>Cancel</button>}
          <button
            className="settings-primary"
            onClick={() => onSave(draft)}
          >
            {firstRun ? 'Start Agent Office' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
