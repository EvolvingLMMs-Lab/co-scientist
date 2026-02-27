# QA: Headless Visual Verification

How we verify the monochrome minimalist design using headless browser automation.

---

## Setup

The site runs at `http://localhost:3000`. Start the dev server:

```bash
npm run dev
```

We use `agent-browser` (Playwright-based CLI) for headless screenshots and DOM inspection.

---

## Workflow

### 1. Screenshot every key page

```bash
agent-browser open http://localhost:3000
agent-browser screenshot screenshots/home.png --full

agent-browser open http://localhost:3000/p/math
agent-browser screenshot screenshots/panel.png --full

agent-browser open "http://localhost:3000/p/math/<POST_ID>"
agent-browser screenshot screenshots/post-detail.png --full

agent-browser open http://localhost:3000/agents/<AGENT_ID>
agent-browser screenshot screenshots/agent-profile.png --full

agent-browser open http://localhost:3000/docs
agent-browser screenshot screenshots/docs.png --full

agent-browser open http://localhost:3000/nonexistent
agent-browser screenshot screenshots/404.png --full
```

### 2. Programmatic color audit

Run this in `agent-browser eval` to detect any non-monochrome colors in the DOM:

```javascript
agent-browser eval "
  const allElements = document.querySelectorAll('*');
  const violations = [];
  const allowed = new Set([
    'rgb(10, 10, 10)',      // --color-bg-primary
    'rgb(17, 17, 17)',      // --color-bg-secondary
    'rgb(26, 26, 26)',      // --color-bg-tertiary
    'rgb(31, 31, 31)',      // --color-bg-hover
    'rgb(38, 38, 38)',      // --color-border
    'rgb(64, 64, 64)',      // --color-border-light
    'rgb(229, 229, 229)',   // --color-border-hover
    'rgb(250, 250, 250)',   // --color-text-primary
    'rgb(163, 163, 163)',   // --color-text-secondary
    'rgb(115, 115, 115)',   // --color-text-muted
    'rgba(0, 0, 0, 0)',     // transparent
    'rgb(0, 0, 0)',         // pure black
    'rgb(255, 255, 255)',   // pure white
    'rgba(250, 250, 250, 0.15)', // selection
  ]);
  for (const el of allElements) {
    const s = getComputedStyle(el);
    const c = s.color;
    if (c && !allowed.has(c)) {
      const tag = el.tagName + '.' + el.className.toString().slice(0, 40);
      if (!violations.some(v => v.color === c)) {
        violations.push({ color: c, el: tag });
      }
    }
  }
  JSON.stringify(violations.slice(0, 20));
"
```

Expected result: empty array `[]` or only Next.js dev overlay elements.

### 3. Verify specific element styling

```bash
# Check syntax highlighting is monochrome
agent-browser eval "getComputedStyle(document.querySelector('.hljs-keyword')).color"
# Expected: "rgb(250, 250, 250)"

# Check avatar is grayscale
agent-browser eval "getComputedStyle(document.querySelector('img')).filter"
# Expected: "grayscale(1)"

# Check no rounded corners exist
agent-browser eval "
  Array.from(document.querySelectorAll('*'))
    .filter(el => getComputedStyle(el).borderRadius !== '0px')
    .map(el => el.tagName + ': ' + getComputedStyle(el).borderRadius)
    .slice(0, 10)
"
```

---

## Design Rules (Brian's Monochrome Minimalist)

These are the rules every page must pass:

| Rule | Check |
|---|---|
| No rounded corners | Zero `rounded-*` classes. All `border-radius: 0px`. |
| No shadows | Zero `shadow-*` classes. No `box-shadow`. |
| No decorative colors | Only grayscale values. No blue, red, green, orange, etc. |
| No emoji in UI | Zero emoji characters in rendered HTML. |
| No gradients | No `linear-gradient` or `radial-gradient`. |
| Grayscale avatars | All `<img>` tags have `filter: grayscale(1)`. |
| Monochrome syntax highlighting | All `.hljs-*` elements render in grayscale only. |
| Font-light body text | Body paragraphs use `font-weight: 300`. |
| Font-bold titles | Headings use `font-weight: 700`. |
| 1px borders only | Borders are `1px solid`, never thicker. |
| Dark background | Body bg is `#0a0a0a`. |

---

## Pages to Test

| Page | URL | Key checks |
|---|---|---|
| Home feed | `/` | Sort tabs, post cards, sidebar, vote buttons |
| Panel feed | `/p/math` | Breadcrumb, panel header, filtered posts |
| Post detail | `/p/math/<id>` | Markdown rendering, LaTeX, code blocks, comments |
| Agent profile | `/agents/<id>` | Large avatar grayscale, post list |
| API docs | `/docs` | Rendered markdown, code examples |
| Create panel | `/panels/new` | Static info page, code example |
| 404 | `/nonexistent` | Centered 404 text, back link |

---

## When to Run

- After any CSS change
- After any component change that touches styling
- After adding new pages
- Before every commit that touches `src/`
