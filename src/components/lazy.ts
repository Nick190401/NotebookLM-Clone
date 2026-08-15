import { lazy } from 'react'

/**
 * Surfaces that only open on an explicit user action. Keeping them out of the
 * entry chunk means the first paint does not pay for nine artifact viewers, the
 * export helpers, or the account dialogs.
 *
 * AddSourceDialog is deliberately not here: a new notebook opens it immediately,
 * so deferring it would only add a round trip to the first thing a user sees.
 */
export const ArtifactConfigDialog = lazy(() =>
  import('./ArtifactConfigDialog').then((module) => ({ default: module.ArtifactConfigDialog })),
)

export const ArtifactPromptDialog = lazy(() =>
  import('./ArtifactPromptDialog').then((module) => ({ default: module.ArtifactPromptDialog })),
)

export const ArtifactViewer = lazy(() =>
  import('./ArtifactViewer').then((module) => ({ default: module.ArtifactViewer })),
)

export const AuthDialog = lazy(() => import('./AuthDialog').then((module) => ({ default: module.AuthDialog })))

export const ChatConfigDialog = lazy(() =>
  import('./ChatConfigDialog').then((module) => ({ default: module.ChatConfigDialog })),
)

export const NoteEditorDialog = lazy(() =>
  import('./NoteEditorDialog').then((module) => ({ default: module.NoteEditorDialog })),
)

export const SettingsDialog = lazy(() =>
  import('./SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
)

export const ShareDialog = lazy(() => import('./ShareDialog').then((module) => ({ default: module.ShareDialog })))

export const SourceDetailDialog = lazy(() =>
  import('./SourceDetailDialog').then((module) => ({ default: module.SourceDetailDialog })),
)
