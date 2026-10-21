import { expect, test } from 'claude-code/testing'

import { buildRequest, parseReply, preview } from './tighten'

test('a well-formed reply splits into the rewrite and the flags', async () => {
  const reply = '===REWRITE===\nAdd a footer to index.html. Let me know: which text?\nDone means: the footer shows on the home page.\n===KNOW===\n- 2024 copyright or 2025? You did not say.\n- none\n'

  expect(parseReply(reply)).toEqual({
    rewrite: 'Add a footer to index.html. Let me know: which text?\nDone means: the footer shows on the home page.',
    flags: ['2024 copyright or 2025? You did not say.'],
  })
})

test('nothing to flag gives no flags, and more than three are cut to three', async () => {
  expect(parseReply('===REWRITE===\nDo X.\n===KNOW===\nnone')?.flags).toEqual([])
  expect(parseReply('**===REWRITE===**\nDo X.\n**===KNOW===**\n- a\n- b\n- c\n- d')).toEqual({ rewrite: 'Do X.', flags: ['a', 'b', 'c'] })
})

test('a reply in the wrong shape is refused, so nothing gets sent', async () => {
  expect(parseReply('Sure! Here is a better prompt: do X')).toBeNull()
  expect(parseReply('===REWRITE===\n\n===KNOW===\n- a')).toBeNull()
  expect(parseReply('REWRITE: do X KNOW: nothing')).toBeNull()
})

test('the request keeps the prompt whole and forbids doing the task', async () => {
  const request = buildRequest('delete the old logs', true)
  expect(request).toContain('delete the old logs')
  expect(request).toContain('Do not do the task')
  expect(buildRequest('x', false)).toContain('cannot see any earlier conversation')
})

test('the preview shows the rewrite and what to know', async () => {
  const shown = preview('make it better', { rewrite: 'Shorten the hero text.', flags: ['Which page?'] })
  expect(shown).toContain('Shorten the hero text.')
  expect(shown).toContain('- Which page?')
})

test('/tighten puts the rewrite in the prompt box only after Use tightened is picked', async ($, on) => {
  const filled: string[] = []
  on('command.register', () => ({ value: { command: 'tighten' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.fork', () => ({ value: { isAnswered: true, text: '===REWRITE===\nShorten the hero text.\n===KNOW===\nnone', usage: {} } }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const asked = (e as { questions: { question: string }[] }).questions
    const question = asked[0]?.question ?? ''

    return { result: { questions: asked, answers: { [question]: 'Use tightened' } } } as never
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true } as never
  })
  on('command.run', () => ({ text: '' }))
  on('ui.status', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({ command: 'tighten', args: 'make the hero better' } as never)

  expect(ran.text).toContain('the tightened prompt is in your prompt box')
  expect(ran.text).not.toMatch(/^tighten:/)
  expect(filled).toEqual(['Shorten the hero text.'])
})
