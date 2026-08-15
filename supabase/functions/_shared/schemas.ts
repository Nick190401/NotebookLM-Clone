import { z } from 'npm:zod@4.4.3'

export const sourceKindSchema = z.enum(['pdf', 'web', 'youtube', 'text', 'audio', 'image'])

export const chatRequestSchema = z.object({
  action: z.literal('chat'),
  notebookId: z.string().min(1).max(120),
  sourceIds: z.array(z.string().min(1).max(120)).min(1).max(100),
  shareToken: z.string().uuid().optional(),
  stream: z.boolean().default(false),
  message: z.string().trim().min(1).max(4_000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(12_000),
      }),
    )
    .max(20)
    .default([]),
  config: z.object({
    style: z.enum(['Default', 'Learning Guide', 'Custom']),
    length: z.enum(['Shorter', 'Default', 'Longer']),
    instructions: z.string().max(2_000),
  }),
  language: z.enum(['English', 'Deutsch']),
})

export const artifactTypeSchema = z.enum([
  'audio',
  'video',
  'mindmap',
  'report',
  'flashcards',
  'quiz',
  'infographic',
  'slides',
  'datatable',
])

export const artifactRequestSchema = z.object({
  action: z.literal('artifact'),
  notebookId: z.string().min(1).max(120),
  sourceIds: z.array(z.string().min(1).max(120)).min(1).max(100),
  type: artifactTypeSchema,
  config: z.object({
    focus: z.string().max(2_000),
    language: z.string().max(60),
    format: z.string().max(100).optional(),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
    amount: z.enum(['Fewer', 'Standard', 'More']).optional(),
  }),
})

export const discoveryRequestSchema = z.object({
  action: z.literal('discover'),
  query: z.string().trim().min(3).max(500),
  language: z.enum(['English', 'Deutsch']).default('English'),
})

export const deepResearchRequestSchema = z.object({
  action: z.literal('research'),
  query: z.string().trim().min(3).max(500),
  language: z.enum(['English', 'Deutsch']).default('English'),
})

export const speechRequestSchema = z.object({
  action: z.literal('speech'),
  text: z.string().trim().min(1).max(4_000),
  voice: z.string().trim().min(1).max(60).default('hannah'),
})

export const notebookAiRequestSchema = z.discriminatedUnion('action', [
  chatRequestSchema,
  artifactRequestSchema,
  discoveryRequestSchema,
  deepResearchRequestSchema,
  speechRequestSchema,
  z.object({ action: z.literal('status') }),
])

export const artifactContentSchema = z.object({
  summary: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string(), sourceIds: z.array(z.string()) })),
  cards: z.array(z.object({ front: z.string(), back: z.string(), sourceId: z.string() })),
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      correctIndex: z.number().int(),
      explanation: z.string(),
      sourceId: z.string(),
    }),
  ),
  nodes: z.array(z.object({ id: z.string(), label: z.string(), parentId: z.string(), sourceId: z.string() })),
  slides: z.array(
    z.object({ title: z.string(), body: z.string(), metric: z.string(), sourceIds: z.array(z.string()) }),
  ),
  columns: z.array(z.string()),
  rows: z.array(z.object({ cells: z.array(z.string()), sourceIds: z.array(z.string()) })),
  metrics: z.array(z.object({ value: z.string(), label: z.string(), context: z.string(), sourceId: z.string() })),
  transcript: z.array(z.object({ speaker: z.string(), text: z.string(), sourceIds: z.array(z.string()) })),
  narration: z.string(),
})
