# Data Analyst Dashboard

Report dashboard that pulls live data from multiple Google Sheets (no backend required).

## Setup per account

1. Open your Google Sheet → **File → Share → Publish to web → Entire Document → CSV** (or just keep default)
2. Make sure sheet is set to **"Anyone with the link can view"**
3. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`SPREADSHEET_ID`**`/edit`
4. Edit `SHEETS` array in `index.html`:
   ```js
   { id: 'your-id', label: 'Display Name', color: '#6366f1',
     spreadsheetId: 'PASTE_ID_HERE', sheet: 'Sheet1', query: 'SELECT * ORDER BY A DESC LIMIT 50' }
   ```

## Sheet must be publicly viewable

Google Sheets gviz endpoint requires public access. Sharing → "Anyone with the link → Viewer".

## Architecture

- **Single HTML file** — zero dependencies, no build step
- **Google Visualization API** (`gviz/tq`) — reads sheets without API key
- **Deployed on Vercel** — push to GitHub, Vercel picks it up automatically

## KPI cards

Edit the `KPI` array to show aggregate summaries per sheet:
```js
KPI = [
  { label: 'Revenue', col: 2, fmt: 'rp' },  // fmt: 'num' | 'rp'
  { label: 'Orders',  col: 3, fmt: 'num' },
];
```
`col` is 0-indexed (0 = column A, 1 = B, etc.).