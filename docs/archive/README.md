# Archive — superseded documents

Kept because they explain **why** things are the way they are, not because they
are still instructions. Nothing here is maintained, and nothing here should be
followed without checking the live document it was replaced by.

| File | Was | Replaced by |
|---|---|---|
| `PLAN-android-tv.md` | the original Android TV plan and brainstorm (options A/B/C, the signing trade-off, risk register) | [../TV.md](../TV.md) for what was built; [../TV-AUDIT.md](../TV-AUDIT.md) for what went wrong on the way; [../ANDROID.md](../ANDROID.md) for the shell |
| `PROMPT-iris-api-players.md` | a ready-to-paste prompt asking the website agent to add `GET /api/players` | [../iris-players-endpoint.md](../iris-players-endpoint.md) — the contract as it stands, including the harvesting fallback that made the request optional |
| `cursor-styles.png` | four pointer styles drawn to scale, from when the pointer was still an arrow | the ring, decided in [../TV.md](../TV.md#no-d-pad-navigation--a-cursor-always) |

The one thing still worth reading in the plan is **§7, distribution and signing**:
why a release key is committed to a public repo. That reasoning is repeated, in
short, in [../ANDROID.md](../ANDROID.md#updater) and
[../../SETUP.md](../../SETUP.md).
