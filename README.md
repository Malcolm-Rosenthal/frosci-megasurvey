# FroSci Megasurvey — Fall 2026

A wrapper app that shows the consent page, runs each student team's study in a
randomised order, and saves every response to a Google Sheet. Each study is its
own small HTML page, so studies can be built and tested one at a time.

## Folder layout

```
index.html            the survey participants open (the wrapper)
config.js             EDIT THIS: study list, Sheet URL, consent/end wording
lib/wrapper.js        wrapper logic (order, conditions, saving, resume, debug panel)
lib/study-kit.js      shared toolkit every study uses (question pages, timers, stimuli)
lib/study-kit.css     shared look
studies/<id>/         one folder per study (index.html + any audio/images)
studies/_template/    copy this to start a new study
gas/Code.gs           Google Apps Script that writes to the Sheet
```

## Testing

You need a local web server (browsers block iframes from `file://`):

```
cd "HTML app files"
python3 -m http.server 8000
```

- Whole survey: <http://localhost:8000/>
- With the debug panel (jump between parts, force a condition, see what's sent): `/?debug=1`
- Only some studies: `/?only=demo-framing,demo-wordlist`
- One study on its own, in **test mode** (condition picker, shows the data at the end, nothing saved):
  `/studies/demo-framing/` — add `?cond=loss` to force a condition
- Forget saved progress in this browser: `/?reset=1`

Debug/only runs are marked `test = TRUE` in the Sheet and keep their progress
separately from real runs.

## Connecting the Google Sheet

Follow the steps at the top of `gas/Code.gs`, then paste the `/exec` URL into
`config.js → endpoint`. With `endpoint: ''` everything works but nothing is sent
(it's logged to the browser console instead).

**What gets saved**

| Tab | One row per… | Contains |
|---|---|---|
| `raw` | item received | the full JSON: the source of truth |
| `sessions` | participant | study order, assigned condition for each study, device (phone/tablet/desktop, screen size…) |
| `study_<id>` | participant × study | condition, position in order, time taken, every answer as its own column, time per page (`ms_<page>`) |
| `session_ends` | participant who finished | finish time, skipped parts, restarts |
| `events` | resume / skip | when someone reloaded, or skipped a part that failed to load |

Responses are saved **after each study**, not just at the end, so people who
drop out partway still contribute the parts they finished. If the connection
fails, responses wait in the browser and are retried automatically; the final
screen doesn't say "saved" until the Sheet has confirmed.

## Hosting (GitHub Pages)

Push this folder to a GitHub repo → Settings → Pages → deploy from the main branch.
The survey link is then `https://<user>.github.io/<repo>/`.

## Adding a study

1. Copy `studies/_template` to `studies/<id>`.
2. Set the same `id` in the page and in `config.js`, plus its `conditions` if the wrapper should assign them.
3. Open `/studies/<id>/` to test it alone, then `/?debug=1&only=<id>` to test it inside the wrapper.
