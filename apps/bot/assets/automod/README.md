# AutoMod word lists

Plain text, one entry per line. `#` starts a comment, blank lines are ignored.
Edit these and re-run `node tools/setup/automod.mjs --apply` — the rules are
matched by name and updated in place, never duplicated.

Discord matches these on **word boundaries**, so `kos` does not fire inside
`kosher`. Wrap an entry in `*` for a wildcard: `*fosh*` matches anywhere.

| File | Rule | Action |
|---|---|---|
| `fa-profanity.txt` | AION · Fosh | delete + alert staff |
| `scam-phrases.txt` | AION · Scam | delete + alert + 5 min timeout |

Profanity only deletes and alerts — a false positive there should cost a
message, not someone's evening. The scam rule times out because the accounts
posting those are not there to talk.
