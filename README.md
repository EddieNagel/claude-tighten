# tighten

A Claude Code mod that checks your prompt before Claude starts and checks the work after Claude finishes.

## What it does

**Before: `/tighten <your prompt>`.** Claude reads your prompt alongside the conversation so far, then:

- rewrites it so it can be acted on in one pass, naming the real files and decisions instead of "it" or "that"
- ends it with a `Done means:` line saying what you will see when it works
- lists up to 3 things you should know first: missing information, a step that costs money or cannot be undone, or a guess it had to make

You pick **Use tightened** or **Use mine**. Your pick goes into the prompt box. Nothing is sent until you press Enter.

**After: the check.** When Claude finishes the reply to that prompt, a second pass reads what actually ran (command output, test results, files) and shows a bar above the prompt:

- `✓ met`, `✗ not met`, `? not shown` (claimed but not proven) or `… in progress`
- whether each warning was dealt with
- up to 2 new points about the result that the warnings did not cover
- how many tokens the check used

If the work is not done, **Ask Claude to finish** puts a follow-up in your prompt box.

## What it costs

Both passes re-read your conversation, mostly from Claude's prompt cache.

- Each check costs about the size of your conversation in cached tokens: about 30k tokens in a fresh session, and 300k or more in a long one.
- `/tighten` costs more if the session sat idle long enough for the cache to expire, because the conversation is then re-read at the full input price.
- The after-check runs right when a reply ends, while the cache is still warm.
- The after-check runs only on replies to prompts that carry a `Done means:` line you sent yourself. It runs once per send, at most 3 times per task. It never runs on helper agents, background notifications or scheduled runs.
- Replies to prompts without a `Done means:` line cost nothing extra.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install tighten --marketplace Chexonbase/claude-tighten
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install tighten --marketplace Chexonbase/claude-tighten
```

In the desktop app: click + next to the prompt box, then Plugins, then Add marketplace with `Chexonbase/claude-tighten`, then Add plugin.

Mods need a Claude Code version recent enough to support them.

## Tests

```
claude plugin test .
```

## License

MIT
