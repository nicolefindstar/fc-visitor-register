# FC visitor register (pilot app, v1.2.0)

Android tablet app for crowd controllers at BNP facilitation centres. It records when each visitor
arrives, when they leave, and whether they were served (and if not, why). Design and reasons:
`../01_Prototype/FC_visitor_app_design_plan.html`.

It is a web app: it is installed from a link, works without internet after the first visit,
and keeps every record on the tablet. Each evening the crowd controller sends the day's CSV file
to ISU by WhatsApp or email. Optionally (v1.2), the tablet also uploads new and changed records by itself
to a Power Automate flow that writes to a SharePoint list: set an upload address in Tablet settings.
Set-up for both: `../04_Deployment/FC_visitor_app_setup_guide.html`.

## Files

| File | What it does |
|---|---|
| `index.html` | All screens, English and Urdu (Urdu is a draft for native proofreading) |
| `admin.html` | For the app master: combines the daily files into one clean Excel or CSV |
| `core.js` | Data rules: numbering, visits, end of day, CSV, change-only upload batches, and reading and merging files for `admin.html` |
| `core.test.js` | Check for `core.js`: `node core.test.js` |
| `sw.js` | Offline cache. **Bump `VERSION` after any change**, or tablets keep the old version |
| `manifest.webmanifest`, `icon-*.png` | Lets Android install it like an app |

## Live link

https://nicolefindstar.github.io/fc-visitor-register/ (GitHub Pages, public repository
`nicolefindstar/fc-visitor-register`, code only). To update: copy the changed files into that
repository, bump `VERSION` in `sw.js`, push to `main`.

## Putting it online

The app has to be served over https once, so tablets can install it. Any static host works;
it holds code only, never visitor data. Options, simplest first:

1. GitHub Pages from a public repository holding only this folder.
2. A WFP SharePoint or Azure static site, if IT prefers a corporate host.

Check with IT before the pilot.

## Setting up a tablet (FC supervisor, once)

1. Open the app link in Chrome, with internet.
2. Chrome menu, **Install app** (or **Add to Home screen**).
3. Open it from the home screen and fill in **Set up this tablet**: FC code, FC name,
   tablet number (1 unless the FC has a second tablet), language, home screen, visitor number
   option and a 4-digit supervisor PIN.
4. In Chrome settings, keep "Clear browsing data" away from this tablet: clearing site data deletes unsent records.

Settings can be changed later from **End of day, Tablet settings** with the PIN.

## Daily routine (crowd controller)

- Someone comes for a service: **Arriving**, pick the visit type, tell them their number.
- Someone leaves: **Leaving** (or tap their number on the live board), ask the questions.
- At closing time: **End of day, Close the day**, then **Send today's file** to the ISU WhatsApp group or email.
- A day that was not sent can be sent later from **End of day, Earlier days** (kept 30 days).
- If the tablet is left on overnight, the app closes the day by itself at midnight
  (open visits become "no exit check"); the file still has to be sent.

## Getting the data (app master)

1. Ask crowd controllers to send each day's file to one place: a dedicated ISU email inbox is easiest
   (attachments save in one go); a WhatsApp group also works (WhatsApp Web, save each file).
2. Save all the files into one folder, for example `01_BNP/02_Data/FC_visitors/raw/`. Keep everything;
   a day sent twice does no harm.
3. Open https://nicolefindstar.github.io/fc-visitor-register/admin.html, select all the files.
   The page reads them on your computer (nothing is uploaded), shows a daily summary by FC and flags
   files that are not visitor files and days that were not closed on the tablet.
4. Download **Excel** (sheets: Visits, Daily by FC, Reasons, Files, Codebook) or **CSV** (the Visits sheet).
   Codes are written out in words, dates and times are real Excel values, each visit appears once.

To skip step 2: crowd controllers email the file to one ISU mailbox and a Power Automate flow saves
each attachment to a SharePoint folder. Setup guide: `../../04_Notes/Email_to_SharePoint_setup.md`.

## The data (raw daily files)

One CSV per tablet per day, named `fc_visits_<FC>_T<tablet>_<date>.csv`, one row per visit.
Put all files in one folder and load it with Power BI's Folder connector or Excel's
"Get data, From folder".

| Column | Meaning |
|---|---|
| `visit_id` | FC, date, tablet, visit type, arrival time, number (U and exit time when the visitor had no number) |
| `number` | Number given at arrival (tablet 2 starts at 501) |
| `visitor_type` | N new registration, F follow-up, R referred, I information only |
| `arrival_time`, `exit_time`, `minutes_at_fc` | T0, T2 and the difference |
| `outcome` | served, not_served, no_exit (left without an exit check) |
| `service` | reg, fu, info, ref (when served) |
| `reason_group`, `reason` | eligibility or operations, and the reason code (when not served) |
| `times_out` | How often they went out and came back |
| `exit_matched` | false when the visitor had no number at exit |
| `closed_by_app` | true when Close the day (or midnight) closed the visit |

No names, CNICs or phone numbers are collected.

## Known limits

- Records live only on the tablet until the file is sent. A lost tablet loses unsent days.
- A visitor's exit must be recorded on the tablet that recorded the arrival.
- Changes after the file is sent are only in the next send; send at closing time.
- Offline works after the first online visit (fonts and files are cached then).

## Testing

```bash
node core.test.js
python3 -m http.server 8766   # then open http://localhost:8766
```
