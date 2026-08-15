import { lazy } from 'react'

/**
 * Surfaces that only open on an explicit user action, kept out of the entry chunk.
 * AddSourceDialog is excluded on purpose: a new notebook opens it immediately.
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
