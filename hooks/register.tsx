import { atom, read, update } from 'claude-code'
import type { ModelCompleteResult, Register } from 'claude-code'

import { afterCheck, armOnSubmit, buildCheckRequest, doneMeansOf, finishRequest, isTypedByPerson, parseVerdict, shouldCheck } from './check'
import { buildRequest, parseReply, preview } from './tighten'

const USE = 'Use tightened'
const MINE = 'Use mine'
const checklist = atom({ plugin: 'tighten', key: 'checklist' } as const, null)
const verdict = atom({ plugin: 'tighten', key: 'verdict' } as const, null)
const isPersonsTurn = atom({ plugin: 'tighten', key: 'isPersonsTurn' } as const, false)

const MARK = { met: '✓', 'not met': '✗', 'not shown': '?', 'in progress': '…' } as const

function whyNot(reply: Extract<ModelCompleteResult, { isAnswered: false }>): string {
  if (reply.reason === 'api-error') {
    const status = 'status' in reply && reply.status ? ` (status ${reply.status})` : ''

    return `Claude's service returned an error${status}`
  }

  return reply.reason === 'aborted' ? 'it was cancelled' : 'Claude sent back nothing'
}

function tokensOf(reply: ModelCompleteResult): { all: number; cached: number } {
  const usage = reply.usage
  const cached = usage?.cache_read_input_tokens ?? 0
  const all = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + cached + (usage?.output_tokens ?? 0)

  return { all, cached }
}

function tokenNote(reply: ModelCompleteResult): string {
  const { all, cached } = tokensOf(reply)

  return all === 0 ? '' : ` (used ${Math.round(all / 1000)}k tokens, ${Math.round(cached / 1000)}k of them from cache)`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tighten',
      description: 'Rewrite your prompt so Claude can act on it, flag what you should know, then check the work when it ends',
      argumentHint: '<your prompt>',
    })

    return next(e)
  })

  on('command.run', { command: 'tighten' }, async ($, e) => {
    const original = e.args.trim() || (await $.prompt.read()).text.trim()

    if (original === '') {
      return { text: 'Type /tighten followed by your prompt.' }
    }

    $.ui.status('tighten: reading your prompt with our conversation (costs more if the session sat idle)...')
    let reply: ModelCompleteResult

    try {
      const forked = await $.model.fork({ prompt: buildRequest(original, true) })
      reply =
        !forked.isAnswered && forked.reason === 'nothing-to-fork'
          ? await $.model.complete({ model: 'haiku', prompt: buildRequest(original, false), maxTokens: 1200 })
          : (forked as ModelCompleteResult)
    } catch {
      return { text: 'could not ask the model. Nothing was changed.' }
    } finally {
      $.ui.status(undefined)
    }

    if (!reply.isAnswered) {
      return { text: `no rewrite, because ${whyNot(reply)}. Nothing was changed.` }
    }

    const tightened = parseReply(reply.text)

    if (tightened === null) {
      return { text: `the rewrite came back in the wrong shape, so nothing was changed. It began: ${reply.text.slice(0, 200)}` }
    }

    const choice = await $.ui
      .ask(preview(original, tightened), { header: 'Tighten', options: [USE, MINE] })
      .catch(() => 'dismissed')

    if (choice !== USE && choice !== MINE) {
      return { text: 'cancelled. Nothing was changed.' }
    }

    const text = choice === USE ? tightened.rewrite : original
    const filled = await $.prompt.fill({ text })

    if (!filled.isFilled) {
      return { text: `could not reach your prompt box. Copy it from here:\n\n${text}` }
    }

    const doneMeans = doneMeansOf(text)
    await update($, checklist, () => (doneMeans === null ? null : { doneMeans, warnings: tightened.flags, isArmed: false, checksUsed: 0 }))
    const check = doneMeans === null ? '' : ' When the reply ends, the work is checked against its "Done means" line.'

    return { text: `${choice === USE ? 'the tightened prompt' : 'your original'} is in your prompt box. Edit it if you like, then press Enter.${check}${tokenNote(reply)}` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined) {
      const text = e.text
      const kind = e.origin.kind
      const before = await read($, checklist)
      const after = armOnSubmit(before, text, kind)

      if (after !== before) {
        await update($, checklist, () => after)
      }

      await update($, isPersonsTurn, () => isTypedByPerson(kind))

      if (isTypedByPerson(kind)) {
        await update($, verdict, () => null)
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  let isChecking = false

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    try {
      const current = await read($, checklist)

      if (isChecking || !shouldCheck(current, e.agentId, e.reason, await read($, isPersonsTurn)) || current === null) {
        return done
      }

      isChecking = true
      $.ui.status('tighten: checking the work against "Done means"...')
      const reply = await $.model.fork({ prompt: buildCheckRequest(current) })
      const found = reply.isAnswered ? parseVerdict(reply.text, current, tokensOf(reply).all) : null
      const latest = await read($, checklist)

      if (latest === null || latest.doneMeans !== current.doneMeans) {
        return done
      }

      await update($, checklist, () => afterCheck(latest, found))

      if (found === null) {
        const why = !reply.isAnswered ? `the check did not run (${reply.reason})` : 'the check came back in the wrong shape'
        $.ui.toast(`tighten: ${why}. It will not retry until you send the Done means line again.`)
      } else {
        await update($, verdict, () => found)
      }
    } catch {
      $.ui.toast('tighten: the check failed. Your reply is unaffected.')
    } finally {
      isChecking = false
      $.ui.status(undefined)
    }

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const found = await read($, verdict)

    if (e.props.hasSurvey || found === null) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const canFinish = found.done === 'not met' || found.done === 'not shown'
    const color = found.done === 'met' ? 'green' : found.done === 'in progress' ? undefined : 'yellow'

    return (
      <Box flexDirection="column">
        <Text color={color}>
          {MARK[found.done]} Done means: {found.done}. {found.evidence}
        </Text>
        {found.warnings.map(one => (
          <Text dimColor={one.status === 'dealt with'}>
            {'  '}
            {one.status === 'dealt with' ? '✓' : '!'} {one.status}: {one.text}
          </Text>
        ))}
        {found.notes.map(note => (
          <Text>  Also: {note}</Text>
        ))}
        {found.done === 'in progress' && <Text dimColor>  It will check once more after your next reply.</Text>}
        <Box>
          {canFinish && (
            <Button
              key="finish"
              label="Ask Claude to finish"
              onPress={async () => {
                const kept = await read($, checklist)

                if (kept !== null) {
                  await $.prompt.fill({ text: finishRequest(found, kept) })
                }
              }}
            />
          )}
          <Text> </Text>
          <Button
            key="dismiss"
            label={found.done === 'met' ? 'OK' : 'Dismiss'}
            onPress={async () => {
              await update($, verdict, () => null)
              await update($, checklist, () => null)
            }}
          />
          <Text dimColor> check used {Math.round(found.tokens / 1000)}k tokens</Text>
        </Box>
      </Box>
    )
  })
}
