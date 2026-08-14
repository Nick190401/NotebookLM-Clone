import type { AppData, Notebook } from '../types'
import { createId } from './id'

export const defaultSettings: AppData['settings'] = {
  theme: 'system',
  outputLanguage: 'English',
}

export function createEmptyAppData(): AppData {
  return {
    notebooks: [],
    settings: { ...defaultSettings },
  }
}

export function createBlankNotebook(title = 'Untitled notebook'): Notebook {
  const timestamp = Date.now()
  return {
    id: createId('notebook'),
    title,
    emoji: '📓',
    sources: [],
    messages: [],
    artifacts: [],
    notes: [],
    chatConfig: { style: 'Default', length: 'Default', instructions: '' },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
