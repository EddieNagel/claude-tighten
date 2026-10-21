import { expect, test } from 'claude-code/testing'

import { afterCheck, armOnSubmit, canRunCheck, doneMeansOf, finishRequest, MAX_CHECKS, offerFor, parseVerdict, shouldOffer } from './check'

const GOAL = 'Done means: the footer shows.'
const pending = { doneMeans: GOAL, warnings: ['Which text?', 'Costs money'], isArmed: false, checksUsed: 0 }
const armed = { ...pending, isArmed: true }
const base = { evidence: 'e', notes: [], tokens: 0 }
const both = [
  { text: 'Which text?', status: 'dealt with' as const, why: '' },
  { text: 'Costs money', status: 'still open' as const, why: '' },
]

test('sending the prompt arms one offer, and keeps the warnings only for the same task', async () => {
  expect(armOnSubmit(pending, `Add a footer.\n${GOAL}`, 'composer')).toEqual(armed)
  expect(armOnSubmit(pending, 'Fix it.\nDone means: tests pass.', 'composer')).toEqual({
    doneMeans: 'Done means: tests pass.',
    warnings: [],
    isArmed: true,
    checksUsed: 0,
  })
  expect(armOnSubmit(pending, GOAL, 'task-notification')).toBe(pending)
  expect(armOnSubmit(armed, 'yes, go ahead', 'composer')).toBe(armed)
})

test('an offer appears only after a reply to the person, from the main thread, under the cap', async () => {
  expect(shouldOffer(armed, undefined, 'answer', true)).toBe(true)
  expect(shouldOffer(armed, undefined, 'answer', false)).toBe(false)
  expect(shouldOffer(armed, 'helper-1', 'answer', true)).toBe(false)
  expect(shouldOffer(armed, undefined, 'aborted', true)).toBe(false)
  expect(shouldOffer(pending, undefined, 'answer', true)).toBe(false)
  expect(shouldOffer({ ...armed, checksUsed: MAX_CHECKS }, undefined, 'answer', true)).toBe(false)
  expect(shouldOffer(null, undefined, 'answer', true)).toBe(false)
})

test('making an offer disarms it, and a check can run only for the task it was offered for', async () => {
  const made = offerFor(armed, 300_000)
  expect(made).toEqual({ checklist: pending, offer: { doneMeans: GOAL, tokens: 300_000 } })
  expect(canRunCheck(made.checklist, made.offer)).toBe(true)
  expect(canRunCheck(made.checklist, null)).toBe(false)
  expect(canRunCheck({ ...pending, doneMeans: 'Done means: other.' }, made.offer)).toBe(false)
  expect(canRunCheck({ ...pending, checksUsed: MAX_CHECKS }, made.offer)).toBe(false)
})

test('after a check: met clears, only "in progress" re-arms, a failed check disarms', async () => {
  expect(afterCheck(pending, { ...base, done: 'met', warnings: both })).toBeNull()
  expect(afterCheck(pending, { ...base, done: 'not met', warnings: both })).toEqual({ ...pending, warnings: ['Costs money'], checksUsed: 1 })
  expect(afterCheck(pending, { ...base, done: 'in progress', warnings: both })?.isArmed).toBe(true)
  expect(afterCheck(pending, null)).toEqual({ ...pending, checksUsed: 1 })
})

test('Ask Claude to finish carries the same Done means line, so it re-arms the same task', async () => {
  const kept = { ...pending, warnings: ['Costs money'], checksUsed: 1 }
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

test('end to end: nothing is spent until Check it is pressed', async ($, on) => {
  on('command.register', () => ({ value: { command: 'tighten' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', () => ({ isFilled: true }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  on('turn.complete', () => ({ text: 'reply' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 301_000, window: 1_000_000 }, rateLimits: {}, cost: {} } }) as never)
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
    $.turn.complete({
      turnId: 't',
      reason: 'answer',
      answer: 'reply',
      durationMs: 1,
      isAborted: false,
      usage: { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 299_000 },
      ...(agentId ? { agentId } : {}),
    } as never)
  const band = () => $.ui.mount({ plugin: 'tighten', component: 'AbovePrompt', surface: 'desktop', props: { hasSurvey: false } } as never)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'tighten', args: 'footer pls' } as never)
  expect(forks).toBe(1)

  await typed(`Add a footer.\n${GOAL}`)
  await ended()
  expect(forks).toBe(1)
  let ui = await band()
  expect((await ui.find({ type: 'Text', text: /Check this work/ }))?.text).toContain('Done means')
  expect((await ui.find({ type: 'Text', text: /re-reads/ }))?.text).toContain('about 301k tokens')
  // Whatever the mods beneath draw stays in the band, under the offer.
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.press({ key: 'skip' })
  await ui.unmount()
  ui = await band()
  expect(await ui.find({ type: 'Text', text: /Check this work/ })).toBeUndefined()
  await ui.unmount()
  expect(forks).toBe(1)

  await typed('thanks, also rename the header')
  await ended()
  await ended('helper-1')
  ui = await band()
  expect(await ui.find({ type: 'Text', text: /Check this work/ })).toBeUndefined()
  await ui.unmount()

  await typed(`Please finish.\n${GOAL}`)
  await ended()
  ui = await band()
  await Promise.all([ui.press({ key: 'check' }), ui.press({ key: 'check' })])
  await ui.unmount()
  expect(forks).toBe(2)
  ui = await band()
  expect((await ui.find({ type: 'Text', text: /Done means: not met/ }))?.text).toContain('no footer in index.html')
  expect((await ui.find({ type: 'Text', text: /Which text\?/ }))?.text).toContain('still open: Which text?')
  await ui.unmount()
})
