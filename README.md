# LeetCode Dashboard

A self-hosted progress dashboard for LeetCode practice. Tracks per-problem time and confidence, schedules revisits via spaced repetition, and visualizes progress with charts.

Single-file Node server, no dependencies.

## Setup

```bash
# 1. Copy the practice tracker into your home directory
cp leetcode-progress.md ~/

# 2. Run the dashboard
node leetcode-dashboard.js

# 3. Open the UI
open http://localhost:3848
```

## Features

- **Practice tracker** — markdown checklist of ~140 LeetCode problems organized into 9 pattern-based modules (Arrays/Hashing, Sliding Window, Stacks, Binary Search, Trees, Graphs, Heaps/Intervals/Greedy, DP, Backtracking/Tries).
- **Inline edit** — click `edit` on any problem to log time, help level (solo / hint / read-solution), and status (fluent / revisit). Saves directly to the markdown.
- **Per-problem notes** — click `notes` to jot a gotcha or pattern reminder. Notes survive subsequent edits.
- **Spaced repetition** — revisit intervals based on how much help you needed (`N` → +1d, `H` → +2d, `Y revisit` → +4d). Fluent problems graduate through 7d → 21d → 60d → 180d (key problems capped at 30d).
- **Next-up card** — surfaces the most-overdue revisit, then due fluent reviews, then the next unattempted problem.
- **Streak tracker** — consecutive calendar days with at least one logged update; past 7 days visualized with green/red/today markers.
- **Difficulty-weighted progress** — easy = 1, medium = 2, hard = 3. Mastery and per-module bars use weighted points.
- **Charts** — progress by difficulty (stacked bars), solve time vs target (strip plot per difficulty), help-needed breakdown.
- **Light + dark mode** — follows system preference, with a manual toggle at the bottom.
- **Liquid-animated progress bars** with a distinct gold "complete" state when every problem in a module is fluent.

## Data layout

Two files are written, both in your home directory:

| Path | Purpose |
|---|---|
| `~/leetcode-progress.md` | The tracker itself — 9 module tables. The dashboard reads/writes this file. Safe to edit directly in any editor. |
| `~/.claude/learning/leetcode-attempts.json` | Auto-managed attempt log: per-problem `lastDate`, `dueDate`, `notes`, and a rolling 20-attempt history. Used for spaced repetition and the streak tracker. |

A `.bak` of the attempts file is kept after each save in case you need to roll back.

## Conventions

The markdown table for every problem has six columns: `Problem | Diff | Pattern | Time | Solo? | Status`.

- **Time** — minutes from first read to working solution. If you read the solution before solving, log how long you struggled before tapping out.
- **Solo?** — `Y` (no help), `H` (used a hint), `N` (read the solution).
- **Status** — `fluent` (could re-solve cold tomorrow) or `revisit` (slow, hinted, or barely passed). Empty = not attempted.
- **(key)** — must-be-fluent problems. The dashboard tracks these separately.

Target solve times: easy ≤15 min, medium ≤25, hard ≤40.

## License

MIT
