# tighten

A Claude Code mod that checks your prompt before Claude starts and checks the work after Claude finishes.

## What it does

**Before: `/tighten <your prompt>`.** Claude reads your prompt alongside the conversation so far, then:

- rewrites it so it can be acted on in one pass, naming the real files and decisions instead of "it" or "that"
- ends it with a `Done means:` line saying what you will see when it works
- lists up to 3 things you should know first: missing information, a step that costs money or cannot be undone, or a guess it had to make

You pick **Use tightened** or **Use mine**. Your pick goes into the prompt box. Nothing is sent until you press Enter.

**After: the check, only if you ask.** When Claude finishes the reply to that prompt, a bar above the prompt asks **Check this work?** and shows roughly how many tokens a check would re-read. Nothing is spent unless you click **Check it**; **Skip** costs nothing. If you click, a second pass reads what actually ran (command output, test results, files) and shows:

- `✓ met`, `✗ not met`, `? not shown` (claimed but not proven) or `… in progress`
- whether each warning was dealt with
- up to 2 new points about the result that the warnings did not cover
- how many tokens the check used

If the work is not done, **Ask Claude to finish** puts a follow-up in your prompt box.

## What it costs

Both passes re-read your conversation, mostly from Claude's prompt cache.

- Each check costs about the size of your conversation in cached tokens: about 30k tokens in a fresh session, and 300k or more in a long one.
- `/tighten` costs more if the session sat idle long enough for the cache to expire, because the conversation is then re-read at the full input price.
- The after-check runs only when you click **Check it**. Click within a few minutes of the reply ending, while the cache is still warm.
- The offer appears only after replies to prompts that carry a `Done means:` line you sent yourself: once per send, at most 3 checks per task. It never appears for helper agents, background notifications or scheduled runs.
- Replies to prompts without a `Done means:` line cost nothing extra.

Measured in one long session (about 300k tokens of conversation): `/tighten` used 302k tokens and the after-check 305k, almost all from cache. That is roughly $0.14 for both at Opus 5.5 prices, about the same as two extra messages in that session. In a fresh session, both together come to about $0.01 to $0.02.

## Is it worth it?

For bigger or vaguer tasks, usually yes. One reply that goes in the wrong direction in a long session costs more than $0.14. The gap-finding and the "not shown" check are what prevent that.

For small tasks, no: on a one-line edit, the checks cost more than the work.

## Ways to make it cheaper

- Click **Skip** when you can already see the work is done. That halves the cost of a task.
- Use `/tighten` on bigger tasks, not one-line edits.
- Use it early in a session, while the conversation is still short.
- Avoid running `/tighten` after the session has sat idle for a long time. The cache will have expired, and the whole conversation is re-read at the full input price.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install tighten --marketplace EddieNagel/claude-tighten
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install tighten --marketplace EddieNagel/claude-tighten
```

In the desktop app: click + next to the prompt box, then Plugins, then Add marketplace with `EddieNagel/claude-tighten`, then Add plugin.

Mods need a Claude Code version recent enough to support them.

## Codex

A version for OpenAI Codex lives in `codex/tighten/SKILL.md`. It is a skill, not a mod, so the same two passes run but you answer in words instead of clicking:

- `$tighten <your prompt>` shows the rewrite, the `Done means:` line and what you should know, then waits. Reply `go` to use it or `mine` to use yours.
- When a task that carried a `Done means:` line finishes, the reply ends with a reminder that `$tighten check` is available. Type it to run the check. If the goal is not met, reply `finish`. Checks are manual and capped at 3 per task, as in Claude Code.

What does not carry over: the Use tightened / Use mine buttons, the automatic Check this work? bar, and the token count after a check. Codex has no mod runtime for those.

Install by copying the folder into your Codex skills directory:

```
git clone https://github.com/EddieNagel/claude-tighten
cp -r claude-tighten/codex/tighten ~/.codex/skills/tighten
```

On Windows PowerShell:

```
Copy-Item -Recurse claude-tighten\codex\tighten $HOME\.codex\skills\tighten
```

Tested with codex-cli 0.155.1.

## Tests

```
claude plugin test .
```

## License

MIT
