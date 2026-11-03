# DashView AI — response template & reporting skills

One definition drives the prompts, the chat view and the PDF export: `js/ai-response-template.js`
(mirrored in `ai-service/app/prompt.py`; `test/ai-template.smoke.test.js` fails if they drift).

## Depth
| Depth | When | Shape |
|---|---|---|
| Lookup | one number, yes/no, a list | 1–3 sentences or one table, no headings |
| Brief | comparison, breakdown, "how is X" | Bottom line, one table, 2–3 insights, one next step |
| Report | "report", "analysis", "board", "detail mein", strategy | full template below |

## Full template (exact English headings, text in the user's language)
```
> **Bottom line:** answer + number + exact period + change vs previous period
## Key figures            table: Metric | Value | vs previous period | Note
## What changed           movers: amount, share of total, direction (facts only)
## Key insights           finding + proving number + why it matters ("Inferred:" for readings)
## Risks and watch-list   concentration, ageing, stuck stages, negative stock, data gaps
## Recommended actions    table: Priority | Action | Evidence | Impact | Effort | Owner
Assumptions: definition, exact period, currency, what was inferred
Confidence: High|Medium|Low — reason
Follow-ups: q1 | q2 | q3
```
Callouts (max 3): `> **Risk:** …`, `> **Action:** …`, `> **Insight:** …`, `> **Note:** …`.
Style: thousands separators, currency code once (PKR 1.2M), signed changes (+12.4%), dates like 12 Oct 2026, ≤7 table columns, no filler, no emojis.

## How the chat shows it
Headline banner, coloured section headings, callouts, right-aligned numeric columns, High/Medium/Low chips,
"In this report" chips (4+ sections), confidence + assumptions footer, skill tag, **Export PDF** on any report.

## Reporting skills
Executive / board summary · Sales performance · Receivables & cash · CRM pipeline · Inventory & supply ·
Purchasing & payables · People & workforce · Period comparison & trend · Exceptions & data quality.
The matching skill (English, Urdu or Roman Urdu wording) is added to the planner and the answer prompt and shown as a tag.
Add or change one in `SKILLS` (`js/ai-response-template.js`).
