import { expect, test, type Page } from '@playwright/test'
import { stubSupabase, SUPABASE_HOST } from './supabase-stub'

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true })

async function createNotebookWithSource(page: Page) {
  await page.getByRole('button', { name: 'New notebook', exact: true }).click()
  await page.getByRole('tab', { name: 'Copied text' }).click()
  await page.getByLabel('Source title').fill('Transit reliability research')
  await page
    .getByLabel('Pasted text')
    .fill('Reliable ten-minute service improved public trust. Timetable coordination reduced missed connections.')
  await page.getByRole('button', { name: 'Add source', exact: true }).click()
}

test('opens an empty workspace and builds the three-panel notebook', async ({ page }) => {
  await stubSupabase(page)
  await page.goto('/')

  await expect(heading(page, 'My notebooks')).toBeVisible()
  await page.getByRole('button', { name: 'New notebook', exact: true }).click()

  await expect(heading(page, 'Sources')).toBeVisible()
  await expect(heading(page, 'Chat')).toBeVisible()
  await expect(heading(page, 'Studio')).toBeVisible()
  await expect(page).toHaveURL(/#\/notebook\//)
})

test('streams a grounded answer and opens the cited evidence in its source', async ({ page }) => {
  await stubSupabase(page, { answerChunks: ['Reliable ten-minute service ', 'improved public trust. [1]'] })
  await page.goto('/')
  await expect(heading(page, 'My notebooks')).toBeVisible()
  await createNotebookWithSource(page)

  await page.getByPlaceholder('Ask about your sources…').fill('What improved public trust?')
  await page.getByRole('button', { name: 'Send message' }).click()

  const citation = page.getByRole('button', { name: 'Citation 1' })
  await expect(citation).toBeVisible()
  await citation.click()

  await expect(heading(page, 'Citation evidence')).toBeVisible()
  await expect(page.locator('mark.citation-highlight')).toContainText('Reliable ten-minute service')
})

test('keeps a citation preview inside the chat column instead of scrolling it sideways', async ({ page }) => {
  await stubSupabase(page, {
    answerChunks: [
      'Reliable ten-minute service improved public trust.\n',
      '[1] Timetable coordination reduced missed connections.',
    ],
  })
  await page.goto('/')
  await expect(heading(page, 'My notebooks')).toBeVisible()
  await createNotebookWithSource(page)

  await page.getByPlaceholder('Ask about your sources…').fill('What improved public trust?')
  await page.getByRole('button', { name: 'Send message' }).click()

  const citation = page.getByRole('button', { name: 'Citation 1' })
  await expect(citation).toBeVisible()
  await citation.hover()

  const stream = page.locator('.message-stream')
  // The preview eases into place, so settle before measuring where it landed.
  await expect(async () => {
    const preview = await stream.locator('.citation-preview').boundingBox()
    const column = await stream.boundingBox()
    expect(preview!.x).toBeGreaterThanOrEqual(column!.x)
    expect(preview!.x + preview!.width).toBeLessThanOrEqual(column!.x + column!.width)
  }).toPass()
  expect(await stream.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
})

test('a reloaded workspace restores the persisted notebook', async ({ page }) => {
  await stubSupabase(page)
  await page.goto('/')
  await expect(heading(page, 'My notebooks')).toBeVisible()
  await createNotebookWithSource(page)
  await expect(heading(page, 'Sources')).toBeVisible()

  await page.reload()

  await expect(heading(page, 'Sources')).toBeVisible()
  await expect(page.getByText('Transit reliability research').first()).toBeVisible()
})

test('a refused answer surfaces the provider message instead of a blank reply', async ({ page }) => {
  const state = await stubSupabase(page)
  await page.goto('/')
  await expect(heading(page, 'My notebooks')).toBeVisible()
  await createNotebookWithSource(page)

  await page.route(`${SUPABASE_HOST}/functions/v1/notebook-ai`, (route) => {
    const body = route.request().postDataJSON() as { action?: string } | null
    if (body?.action !== 'chat') return route.fallback()
    return route.fulfill({
      status: 429,
      json: { error: { code: 'QUOTA_EXCEEDED', message: 'The chat answer limit of 60 per hour is reached.' } },
    })
  })

  await page.getByPlaceholder('Ask about your sources…').fill('What improved public trust?')
  await page.getByRole('button', { name: 'Send message' }).click()

  await expect(page.getByText(/limit of 60 per hour/).first()).toBeVisible()
  expect(state.savedSnapshots.length).toBeGreaterThan(0)
})
