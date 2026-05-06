# KYT Alert Summarizer — Chrome Extension

Turns a KYT (Chainalysis / similar) CSV alert export into ready-to-paste compliance narrative paragraphs.

---

## What it does

Reads a KYT alert export CSV and generates one paragraph per logical alert group, using this template:

**Withdrawal Attempts**
> On/From [date] to [date], the user made N withdrawal attempt(s) directly to [Risk Entity] ([category]), for a total of X.XX USDT (TRON) (at the time of the transfer).

**Deposits (RECEIVED TRANSFER)**
> From [date] to [date], the user made N deposits directly from [Risk Entity] ([category]), for a total of X.XX USDT USD (at the time of the transfer) to his account receiving address: [address], via the following transaction(s): [tx hashes]

**Outgoing Transfers (SENT TRANSFER)**
> From [date] to [date], the user made N outgoing transfers connected to [Risk Entity] ([category]), for a total of X.XX USDT USD (at the time of the transfer) from his account sending address: N/A, via the following external address(es): [addresses]

### Filter logic applied

| Condition | Included? |
|---|---|
| `Alert Type = WITHDRAWAL` | ✅ Always |
| `Alert Type = TRANSFER` and `% of Transfer ≥ 80` | ✅ Yes |
| `Alert Type = TRANSFER` and `% of Transfer < 80` | ❌ No |
| `State = INVALID` (any type) | ❌ Excluded |

---

## Install in Chrome (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle, top-right)
4. Click **Load unpacked**
5. Select the `kyt-alert-summarizer/` folder
6. The extension icon will appear in your toolbar — pin it for easy access

---

## Usage

1. Click the extension icon to open the popup
2. Drag & drop your CSV export onto the drop zone, **or** click **Choose File**
3. Click **Generate Summary**
4. Review the output and click **Copy to Clipboard**

---

## Push to GitHub

```bash
cd kyt-alert-summarizer
git init
git add .
git commit -m "Initial commit: KYT Alert Summarizer Chrome extension"
# Create repo on GitHub first, then:
git remote add origin https://github.com/<your-username>/kyt-alert-summarizer.git
git push -u origin main
```

Or with the GitHub CLI:
```bash
gh repo create kyt-alert-summarizer --public --source=. --push
```

---

## CSV column requirements

The extension expects the standard KYT export headers:

`Alert ID`, `Severity`, `Category`, `Alert Created At`, `Transfer At`, `Status`, `Service Name`, `Exposure`, `Direction`, `Alert Amount`, `User ID`, `Asset`, `Tx Hash`, `Tx Index`, `Output Address`, `Alert Type`, `State`, `% of Transfer`, `Symbol`, `Network`, …
