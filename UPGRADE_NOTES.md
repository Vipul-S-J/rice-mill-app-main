# Upgrade notes: Labour & Staff, Backup and Restore

## Before you install
1. In the **old** app open **More → Backup / Restore** and save a backup file somewhere safe (the old page works as before).
2. Install the new version over the old one. Do not uninstall first, or the saved data on the phone is lost.

## What happens to your data on the first start
- The database version goes from 3 to 4. Before that upgrade runs, the app saves an untouched copy of your data inside the app
  (**More → Backup / Restore → Backups kept inside the app**, shown as "Before upgrade").
- New empty tables are added (attendance, farm / other work, advances, payroll). Nothing is deleted or changed.
- If saved data ever cannot be read, the app keeps a rescue copy instead of silently starting empty.
- Old workers keep working: workers are the same records as before, so every hulling wage entry and payment stays linked.
  They show as "Hulling wage worker" in Staff until you add staff details. Trading names are linked to supplier / customer records (see the earlier notes).

## Labour & Staff (More → Labour & Staff) — the only Labour section
| Tab | What it does |
|---|---|
| Overview | Active staff, present today, pending to pay, outstanding advances, payroll progress |
| Staff | Register / edit workers. Checks for an existing person (by name or mobile) first and reuses that record |
| Attendance | Mark Present / Half day / Absent / Leave for a date, bulk "all present / all absent", overtime, edit a saved day, monthly view. Farm / other work is recorded separately with its own rate |
| Worker Ledger | Wages earned, hulling wages, advances, payments, deductions, running balance; date filter, search, PDF |
| Advances | Give / edit / delete advances. Each creates one cashbook payment automatically |
| Salary & Payroll | One payroll per worker per month. Generate (draft) → review / edit → Finalise → record payments |
| Hulling Labour Wages | The previous Labour page, unchanged (per-quintal wages, manual entries, payments, pending) |
| Reports | 9 reports with date filter, search, sorting, CSV, Share PDF and Print / Save PDF |

Wage rules (all results can be edited before finalising):
- **Daily:** full day = rate, half day = half rate, absent / leave = nothing. **Hourly:** hours × rate (blank hours = 8 for a full day, 4 for a half day).
- **Monthly:** salary, less (absent days + ½ × half days) × salary ÷ days in the month. Paid leave. Days that were not marked are never deducted.
- **Overtime:** overtime hours × overtime rate. If the overtime rate is blank it is the hourly equivalent of the wage rate (8-hour day, 30-day month).
- **Farm / other work:** its own quantity × its own rate. Never taken from the mill wage. Added to the payroll of that month.
- **Contract / piece-rate:** paid through Hulling Labour Wages, not payroll, so hulling wages are never counted twice.
- **Expenses:** only **finalised** payrolls count as an expense (Home and Daily Closing). Advances are not an expense; they are recovered through salary.
- **Net payable** = previous pending + (gross − deductions) − advances given this month. A worker who holds more advance than earned shows "worker owes the mill".
- A payroll with payments cannot be reopened or deleted. Payments are accepted only on a finalised payroll, and the same payment saved twice within seconds is ignored.

## Backup and restore (More → Backup / Restore)
- **Create backup:** you choose where the file is saved. `SPRM_Backup_YYYY-MM-DD_HH-MM-SS.json`, or `.sprmbackup` when password-protected.
  After saving, the screen shows the file name, format, time, size and the location **only if the phone reports it**.
- **Encryption:** AES-256-GCM, key from your password with PBKDF2-SHA256 (600,000 rounds), a new random salt and nonce for every backup. The file header is authenticated too.
  The password is never stored or sent anywhere. **If you forget it, nobody can open that backup.**
- **Restore:** choose a `.json` (old or new format) or `.sprmbackup` file. Encrypted files ask for the password; a wrong password or a damaged file restores nothing.
  You see what is in the file, then choose:
  - **Merge / Import:** adds records that are not in the app. Existing records are never overwritten (differences are counted and reported). The same person is matched by name.
  - **Full Restore:** replaces everything. A safety copy of the current data is saved first.
- **Automatic backup:** daily / weekly / monthly and optionally shortly after changes. Saved inside the app and, if you choose one, into a folder on the phone (Android folder picker) or computer.
  Retention keeps the newest backup of each of the last N days / weeks / months (default 7 / 4 / 3). The newest backup is never removed, an old one is removed only after a new one is saved,
  and manual backups are never removed automatically. Encrypted automatic backups use a password key kept on the device (the password itself is not stored).
- **Limits to know:**
  - Automatic backups run **while the app is open** (and the next time it is opened if one was due). A phone cannot run them while the app is closed without extra native background code, which is not part of this version.
  - **Copy on the phone:** on Android 10 or newer every automatic backup is also saved in the phone's **Documents / SPRM Backups** folder (Files app → Documents), with no extra permission. These copies stay if the app is removed. You can pick a different folder instead. On Android 9 or older, pick a folder (the Documents folder needs Android 10).
  - Copies "inside the app" are lost if the app is uninstalled, which is why the phone copy matters.
  - Desktop browsers cannot open a folder for you, and may ask for folder access again after the page is reloaded.
  - Google Drive backup is **not included** (not requested).

## Android build notes
Native code added (needs the first APK build to be verified): `FileSavePlugin.java` ("Save as", folder picker, write / list / delete / open in the chosen folder) and `@capacitor/share` + `@capacitor/filesystem`.
`npm ci`, `npm run build` and `npx cap sync android` are unchanged.
