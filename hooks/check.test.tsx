import { expect, test } from 'claude-code/testing'

import { afterCheck, armOnSubmit, doneMeansOf, finishRequest, MAX_CHECKS, parseVerdict, shouldCheck } from './check'

const GOAL = 'Done means: the footer shows.'
const pending = { doneMeans: GOAL, warnings: ['Which text?', 'Costs money'], isArmed: false, checksUsed: 0 }
const armed = { ...pending, isArmed: true }
const base = { evidence: 'e', notes: [], tokens: 0 }
const both = [
  { text: 'Which text?', status: 'dealt with' as const, why: '' },
  { text: 'Costs money', status: 'still open' as const, why: '' },
]

test('sending the prompt arms one check, and keeps the warnings only for the same task', async () => {
  expect(armOnSubmit(pending, `Add a footer.\n${GOAL}`, 'composer')).toEqual({ ...armed, checksUsed: 0 })
  expect(armOnSubmit(pending, 'Fix it.\nDone means: tests pass.', 'composer')).toEqual({
    doneMeans: 'Done means: tests pass.',
    warnings: [],
    isArmed: true,
    checksUsed: 0,
  })
  expect(armOnSubmit(pending, GOAL, 'task-notification')).toBe(pending)
  expect(armOnSubmit(armed, 'yes, go ahead', 'composer')).toBe(armed)
})

test('the check runs only on a reply to the person, from the main thread, under the cap', async () => {
  expect(shouldCheck(armed, undefined, 'answer', true)).toBe(true)
  expect(shouldCheck(armed, undefined, 'answer', false)).toBe(false)
  expect(shouldCheck(armed, 'helper-1', 'answer', true)).toBe(false)
  expect(shouldCheck(armed, undefined, 'aborted', true)).toBe(false)
  expect(shouldCheck(pending, undefined, 'answer', true)).toBe(false)
  expect(shouldCheck({ ...armed, checksUsed: MAX_CHECKS }, undefined, 'answer', true)).toBe(false)
  expect(shouldCheck(null, undefined, 'answer', true)).toBe(false)
})

test('one check disarms; only "in progress" keeps one more; met clears', async () => {
  expect(afterCheck(armed, { ...base, done: 'met', warnings: both })).toBeNull()
  expect(afterCheck(armed, { ...base, done: 'not met', warnings: both })).toEqual({ ...armed, warnings: ['Costs money'], isArmed: false, checksUsed: 1 })
  expect(afterCheck(armed, { ...base, done: 'in progress', warnings: both })?.isArmed).toBe(true)
  expect(afterCheck(armed, null)).toEqual({ ...armed, isArmed: false, checksUsed: 1 })
})

test('Ask Claude to finish carries the same Done means line, so it re-arms the same task', async () => {
  const kept = { ...armed, warnings: ['Costs money'], isArmed: false, checksUsed: 1 }
  const text = finishRequest({ ...base, done: 'not met', warnings: both }, kept)
  expect(doneMeansOf(text)).toBe(GOAL)
  expect(armOnSubmit(kept, text, 'composer')).toEqual({ ...kept, isArmed: true })
})

test('a verdict is read strictly: no echoed template, markdown allowed, no partial words', async () => {
  const shape = (done: string, warnings = '1. dealt with - ok\n2. still open - no') => `===DONE===\n${done}\n===WARNINGS===\n${warnings}\n===NEW===\n- The build is slower\n- none`
  expect(parseVerdict(shape('met | not met | not shown | in progress - x'), armed, 0)).toBeNull()
  expect(parseVerdict(shape('**Not met** - no footer'), armed, 0)?.done).toBe('not met')
  expect(parseVerdict(shape('metadata looks fine'), armed, 0)).toBeNull()
  expect(parseVerdict(shape('not shown - nothing ran', '1. dealt with - used index.html'), armed, 9)).toEqual({
    done: 'not shown',
    evidence: 'nothing ran',
    warnings: [
      { text: 'Which text?', status: 'dealt with', why: 'used index.html' },
      { text: 'Costs money', status: 'unknown', why: 'the check did not say' },
    ],
    notes: ['The build is slower'],
    tokens: 9,
  })
  expect(parseVerdict('Looks good to me!', armed, 0)).toBeNull()
})

test('end to end: one check per send, never on follow-ups or background turns', async ($, on) => {
  on('command.register', () => ({ value: { command: 'tighten' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', () => ({ isFilled: true }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  on('turn.complete', () => ({ text: 'reply' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const asked = (e as { questions: { question: string }[] }).questions

    return { result: { questions: asked, answers: { [asked[0]?.question ?? '']: 'Use tightened' } } } as never
  })
  let forks = 0
  on('model.fork', () => {
    forks += 1
    const text =
      forks === 1
        ? `===REWRITE===\nAdd a footer.\n${GOAL}\n===KNOW===\n- Which text?`
        : '===DONE===\nnot met - no footer in index.html\n===WARNINGS===\n1. still open - not asked\n===NEW===\nnone'

    return { value: { isAnswered: true, text, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2000 } } }
  })
  const typed = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  const ended = (agentId?: string) =>
    $.turn.complete({ turnId: 't', reason: 'answer', answer: 'reply', durationMs: 1, isAborted: false, ...(agentId ? { agentId } : {}) } as never)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'tighten', args: 'footer pls' } as never)
  expect(forks).toBe(1)

  await typed(`Add a footer.\n${GOAL}`)
  await ended()
  expect(forks).toBe(2)
  const ui = await $.ui.mount({ plugin: 'tighten', component: 'AbovePrompt', surface: 'desktop', props: { hasSurvey: false } } as never)
  expect((await ui.find({ type: 'Text', text: /Done means: not met/ }))?.text).toContain('no footer in index.html')
  expect((await ui.find({ type: 'Text', text: /Which text\?/ }))?.text).toContain('still open: Which text?')
  await ui.unmount()

  await typed('thanks, also rename the header')
  await ended()
  await ended('helper-1')
  await $.prompt.submit({ text: GOAL, wait: false, origin: { kind: 'task-notification' } })
  await ended()
  expect(forks).toBe(2)

  await typed(`Please finish.\n${GOAL}`)
  await ended()
  expect(forks).toBe(3)
})
