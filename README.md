# FleetPro — work & pay fleet management (GitHub Pages + Google Sheets)

FleetPro runs a car business where drivers pay daily:

- **Work & pay:** drivers pay **GHS 400 a day, Monday to Saturday**, for **4 years**, after which the car is theirs. They pay a **security deposit** first: 15,000 for a new car, 5,000–10,000 for a retrieved car from a driver who stopped.
- **Daily hire (electric cars):** **Cerio GHS 500** and **BYD GHS 700** a day. These drivers never own the car.
- Drivers pay **the day after they work**, by **MTN Mobile Money**, and every payment is recorded with its MoMo reference.
- Each driver belongs to a **manager**. Managers produce **daily, weekly and monthly reports** covering payments, amounts owing, car condition, cars due for service, and driver complaints, including whether a driver wants to keep working or stop.

All rates, the deposit amounts and the 4-year term can be changed in **Settings**.

---

## How it fits together

- **Google Sheet** (in your Google Drive): holds all the data, one tab per table: `drivers`, `contracts`, `payments`, `checkins`, `vehicles` and others.
- **Google Apps Script** (attached to the Sheet): checks logins and works out balances, arrears and alerts.
- **GitHub Pages**: hosts the web app for free at `https://YOUR-USERNAME.github.io/fleetpro/`.

## Setting it up (about 15 minutes)

### Part 1 — Google Sheet and script
1. Go to **https://sheets.new** and name the sheet **FleetPro**.
2. Choose **Extensions → Apps Script**. Delete what's there, paste in everything from `apps-script/Code.gs`, and click **Save** 💾.
3. Click the **gear (Project Settings)** and set **Time zone** to *(GMT+00:00) Accra*.
4. Back in the editor, choose **`setup`** in the dropdown next to **Debug** and click **Run**.
   When Google asks for permission, choose **Review permissions**, pick your account, then **Advanced → Go to FleetPro (unsafe) → Allow**. This warning is normal for your own script.
5. *(Optional, to try it out)* Run **`loadDemoData`**. It creates 21 cars, 24 drivers, 3 managers and 12 weeks of payments.
   ⚠️ It wipes existing data, so never run it once you have real records.
6. Click **Deploy → New deployment**, click the gear, and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**. Copy the **Web app URL** (it ends in `/exec`).

### Part 2 — GitHub Pages
The ready-to-run website is in the `docs` folder of this repository.
1. Open **docs → config.js**, click the ✏️ pencil, paste your Web app URL between the quotes, and click **Commit changes**.
2. Go to **Settings → Pages**. Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: main**, **Folder: /docs**, and click **Save**.
3. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/fleetPro/`.

### Part 3 — First sign in
Sign in with **admin@fleet.local** / **admin12345**, then:
1. **Settings → Your password:** change the password.
2. **Settings → Company:** check the rates (400 / Cerio 500 / BYD 700), the deposits and the term.
3. **Settings → Users:** add each manager with the **Manager** role. Managers can record payments and check-ins, and they see their own drivers first.

> **Already set up the earlier version?** Paste the new `Code.gs` over the old one, save, and run **`setup`** again. This adds the new tabs and columns and keeps your data. Then go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**, and replace the `docs` folder on GitHub with the new one.

---

## Using it day to day

### Adding your cars and drivers
1. **Cars → Add car.** For the electric cars, put **Cerio** or **BYD** as the make. That's how FleetPro picks the 500 or 700 rate.
2. **Drivers → Add driver.** Choose their **manager** and enter their **MTN MoMo number**.
3. **Contracts → Add contract.** Choose the driver and car, **Work & pay** or **Daily hire**, the start date, and the deposit with its MoMo reference.
   - Leave **Daily payment** and **End date** empty: FleetPro fills in 400 (or 500/700) and the 4-year end date.
   - A car that has **never had a driver** is a *new car* and needs the 15,000 deposit. A car that had a driver before is a *retrieved car* and accepts from 5,000.
   - Starting a contract assigns the car to the driver.

### Drivers who are already part-way through their 4 years
Create their contract with their **real start date**. Then go to **Payments → Add payment** and record one payment with **Type: Adjustment**. Use the **total they've paid so far** as the amount and the day before you start recording daily payments as the date. From then on, record daily payments as normal. FleetPro works out what's owing and what's left on the car from the start date.

### Every day (managers)
- **Overview** shows who **hasn't paid for yesterday**, today's collections, and who is most behind.
- **Record a payment:** open the driver and click **Record payment**. The work date is filled in with the next unpaid day. Type in the **MoMo transaction ID**. The same reference can't be entered twice, and a day can't be paid for twice.
- **Excused days** (car in the workshop, public holiday): record a payment with **Type: Excused days**, the amount for those days, and the reason. This clears those days from what's owing but doesn't count toward paying off the car, so the driver still pays the full car price.

### Every week (managers)
- **Driver check-ins → Add check-in** for each driver: car condition, odometer reading (keeps service reminders accurate), **whether the driver wants to continue, is undecided, or wants to stop**, and any complaint and the action taken. Mark complaints **Resolved** when they're dealt with.

### Reports
- **Manager reports** has **Daily / Weekly / Monthly** views. Each driver shows paid vs due, the shortfall, total owing, the car balance, the car's condition and any service or paperwork due, and their latest feedback.
  - Admins can see all managers side by side and click one to drill in.
  - Use **Print** for a paper copy, or **Export CSV** to open it in Excel.
- **Alerts** lists drivers behind on payments (3+ days by default), drivers who want to stop, open complaints, services due, and expiring insurance, roadworthy and licences.

### When a driver stops or finishes
- **Stops:** edit their contract, set **Status: Stopped**, and give the reason. The car is freed and shows under "Cars waiting for a driver" on the Overview, ready for a new driver on a retrieved-car deposit. Any amount still owing stays on their record.
- **Finishes:** when their payments reach the full contract value, FleetPro **completes the contract automatically** and marks the car **Handed over**.

### How the numbers are worked out
- **Due so far** = daily rate × every Mon–Sat from the start date up to **yesterday**, because today's work is paid tomorrow.
- **Owing** = due so far − money paid − excused days. A negative figure shows as "ahead".
- **Car value** (work & pay) = daily rate × every Mon–Sat in the 4-year term. At GHS 400 that's about GHS 500,000.
- **Left to own the car** = car value − money paid. The deposit is kept separately as security and doesn't count toward the car.

---

## Everyday notes
- **Updating the script:** after pasting new code, use **Deploy → Manage deployments → ✏️ → New version** so the URL stays the same.
- **Backups:** on the Sheet, use **File → Make a copy** or **File → Download → Excel**. Google also keeps **Version history**.
- **Editing in the Sheet:** you can view or fix values directly, but don't rename tabs, change the header row, or edit the `id` column.
- **Speed:** each action takes 1–3 seconds because it goes through Google. That's fine for a few dozen cars and a handful of managers.

## Folder contents
```
apps-script/Code.gs            backend — paste into Apps Script
apps-script/dev/               emulator + tests for developers (not needed to run)
docs/                          the built website GitHub Pages serves
docs/config.js                 ← your Web app URL goes here
client/                        source code of the website (rebuild into docs/ with `npm run build`)
```

Developers: `node --test apps-script/dev/test.js` runs the backend tests against an emulated Sheet. `node apps-script/dev/serve.js` starts a local copy of the API with demo data.
