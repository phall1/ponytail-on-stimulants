# Examples

Inherited upstream Ponytail model output, kept verbatim for attribution and comparison. Each file shows the same task answered by the same model with no skill and with upstream Ponytail. Model: Claude Haiku 4.5, temperature 1; historical source: `benchmarks/output.json`.

These are not fork benchmark claims. The active benchmark config now loads Ponytail on Stimulants and writes new output; see [the benchmark provenance note](../benchmarks/README.md) and the fork-specific [completion corpus](../benchmarks/completion/).

| Example | Without (LOC) | With (LOC) |
|---|--:|--:|
| [Email Validation](email-validation.md) | 75 | 3 |
| [Debounce](debounce.md) | 116 | 10 |
| [CSV Sum](csv-sum.md) | 20 | 3 |
| [Countdown Timer](react-countdown.md) | 267 | 9 |
| [Rate Limiting](rate-limit.md) | 128 | 10 |
