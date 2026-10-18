# Baby Registry

A gift registry for your baby, built with **HTML, CSS, JavaScript, PHP and MySQL**. That makes it
a good fit for Hostinger shared hosting, which has PHP and phpMyAdmin but no Node.js. There is no
build step and nothing to install. You upload the files, import one SQL file and fill in one
settings file.

**What it does**

Guests move through the site one screen at a time:

1. **Welcome.** "Welcome to the Uzorka family", a floating balloon and one big **Take a guess**
   button. The registry is not shown here; a small "skip" link is there for guests who only want it.
2. **Guess.** Pick 💙 Boy or 💗 Girl, **suggest a name for the baby**, add your name and a wish.
   Guests can also leave an email or WhatsApp number to be told when the gender is revealed.
3. **Pop the balloon.** One tap bursts it, with confetti, a pop sound and vibration on phones.
4. **Result.**
   - *While it's still a secret:* "It's still a secret 🤫", the live vote count ("75% think girl"),
     a countdown to your reveal day, and "We'll message you the moment it's revealed".
   - *After you press "Reveal now" in the admin:* **"It's a girl!"** or **"It's a boy!"**, whether
     the guest guessed right, and the page turns pink or blue. Everyone who left an email or
     WhatsApp number is sent the news automatically, and earlier guests get to pop the balloon
     again for the real answer.
   - The gender is **never sent to the browser before you reveal it**, so nobody can peek.
5. **Registry.** Only the **names** of the items: no prices and no quantities. Guests tap
   **I'll get this** and give their **full name, phone, email and the day they will send it**.
   Anything someone has already picked is **greyed out** ("Someone has picked this 💛").

After that:

- Guests get a **confirmation email** straight away, and **on the day they chose, a reminder**
  by email (and WhatsApp if they ticked it) with the gift and your **bank account details**.
- If a gift is still unpaid a few days later, one gentle follow-up goes out (optional).
- The **wishes wall** shows the wishes and suggested names guests chose to share.
- The **admin dashboard** lists every pledge. Click **Mark paid** and the guest automatically gets a
  **thank-you email/WhatsApp**. You can also send reminders by hand, change dates, cancel pledges,
  see every guess and suggested baby name, export everything to Excel/CSV, and add, edit or hide
  gift items (with photos).

---

## 1. Requirements

| Item | Needed |
| --- | --- |
| Hosting | Any Hostinger web/shared plan |
| PHP | **8.1 or newer** (hPanel → Advanced → PHP Configuration) |
| Database | One MySQL database (hPanel → Databases) |
| Email | A mailbox on your domain, e.g. `registry@yourdomain.com` (recommended) |
| WhatsApp | Optional, see section 7 |

## 2. Files

```
baby-registry/
├── index.php                 The public registry page
├── api/pledge.php            Saves a pledge and sends the confirmation
├── api/guess.php             Saves a boy/girl guess and returns the vote count
├── admin/                    Admin dashboard (login, pledges, items, CSV export)
├── cron/send-reminders.php   Sends the reminders, run once a day
├── includes/config.php       ← ALL your settings live here
├── includes/…                Database, email, WhatsApp and message code
├── database/schema.sql       Import this in phpMyAdmin
├── assets/                   CSS and JavaScript
└── uploads/                  Item photos you upload from the admin
```

## 3. Create the database

1. hPanel → **Databases → Management**. Create a database and a user, and write down the
   **database name, username and password**. On Hostinger they look like `u123456789_registry`.
2. Click **Enter phpMyAdmin** next to the new database.
3. Open the **Import** tab, choose `database/schema.sql` and click **Import**.

This creates the tables and the gift list from your sample (Diapering, Feeding, Laundry and
Bathing, Clothing, For Mum, Nursery, Additional), plus a cash gift option. Guests only ever see
the item names. Each item has an optional *estimated value*, which only you see in the admin
(the sample values are rough guesses; change or clear them as you like).

If you already imported an earlier version of `schema.sql`, delete the tables in phpMyAdmin first
(select all → Drop), then import again.

## 4. Upload the files

1. hPanel → **Files → File Manager** → `public_html`.
2. Choose where the registry should live:
   - **Its own folder**, e.g. `yourdomain.com/registry`: create `public_html/registry` and upload
     the *contents* of `baby-registry/` into it.
   - **A subdomain**, e.g. `baby.yourdomain.com`: create the subdomain in hPanel and upload the
     contents into its folder.
3. Upload hidden files too (`.htaccess` files). They protect your settings and uploads.

## 5. Fill in `includes/config.php`

Open it in File Manager (right-click → Edit). Everything marked `CHANGE ME`:

| Setting | What to put |
| --- | --- |
| `site.url` | Full address, e.g. `https://yourdomain.com/registry` (used in email links) |
| `site.baby_name`, `parents`, `headline`, `intro` | The text on your page |
| `site.family_name` | Shown as "The *Uzorka* are expecting" |
| `site.due_date` | `YYYY-MM-DD`, used for the "Baby arrives in … days" countdown (`''` hides it) |
| `site.reveal_date` | `YYYY-MM-DD` of your reveal, shown as a countdown while it is a secret (optional) |
| `site.currency` | `₦` by default |
| `db.*` | The database name, user and password from step 3 (host stays `localhost`) |
| `bank_accounts` | Your bank name, account name and number. Add more blocks for more accounts |
| `admin.notify_email` | Your email, so you hear about every new pledge |
| `mail.*` | See below |

**Email (recommended setup)**

1. hPanel → **Emails** → create a mailbox such as `registry@yourdomain.com`.
2. In `config.php`, set `from_email` and `smtp.username` to that address and `smtp.password` to its
   password. Leave `host` as `smtp.hostinger.com`, `port` as `465` and `encryption` as `'ssl'`.
3. Put your personal email in `reply_to` so guests' replies reach you.

No extra library is needed because the SMTP sender is built in. If you would rather not set up a
mailbox, change `transport` to `'mail'`, but those emails are more likely to land in spam.

## 6. Set your admin password

1. Visit `https://yourdomain.com/registry/admin/`.
2. Because no password is set yet, the page asks you to choose one. Type it and click
   **Create password hash**.
3. Copy the long line it shows (it starts with `$2y$`), paste it as `password_hash` in
   `config.php`, and save.
4. Reload the page and log in with username `admin` (or whatever you set as `admin.username`)
   and your password.

Your real password is never stored, only the hash.

## 7. Turn on the daily reminders (cron job)

Reminders are sent by `cron/send-reminders.php`, which you schedule once a day.

1. hPanel → **Advanced → Cron Jobs**.
2. Type: **PHP**. Command / script path: the full path to the file, for example
   `/home/u123456789/domains/yourdomain.com/public_html/registry/cron/send-reminders.php`.
   File Manager shows the exact path at the top.
3. Schedule: **once a day**, e.g. minute `0`, hour `8` (8 am server time), every day.

If you choose **Custom** instead, the command is
`/usr/bin/php /home/u123456789/domains/yourdomain.com/public_html/registry/cron/send-reminders.php`.

Running it more than once is safe, because nobody gets the same reminder twice. If a run is
missed, the next run catches up.

**Alternative:** set `reminders.web_key` to a long random string and have any external cron
service (e.g. cron-job.org) open
`https://yourdomain.com/registry/cron/send-reminders.php?key=YOUR_KEY` daily.

**Test it:** make a pledge with today's date, then run the cron job once ("Run" in hPanel, or open
the web-key address). The reminder email should arrive.

## 8. WhatsApp (optional)

There are three options. Set `whatsapp.provider` in `config.php`.

### `'none'` (default, free, no setup)
Nothing is sent automatically on WhatsApp. Instead, every pledge in the admin dashboard has a
green **WhatsApp** button. It opens WhatsApp (on your phone or WhatsApp Web) with the right
message already typed in: the reminder with bank details for unpaid gifts, the thank-you for paid
ones. You just press send. After you click **Mark paid**, a **Send on WhatsApp** button also
appears at the top. The **Needs action** tab shows everyone whose payment day has come, so a
quick daily look is enough.

### `'meta'` (WhatsApp Cloud API, automatic)
Meta's official API. Meta charges per conversation, and the first 1,000 service conversations a
month are free. You need:

1. A Meta Business account and an app with **WhatsApp** added
   (developers.facebook.com → Create app → Business → add WhatsApp).
2. A phone number for the business. It cannot also be used in the normal WhatsApp app.
3. A **permanent access token** (System User in Business Settings) and the **Phone number ID**.
   Put both in `config.php`.
4. **Four message templates**, created and approved in WhatsApp Manager
   (category *Utility*, language *English*). Use these names, or change the names in `config.php`.
   Each `{{n}}` must be in this order:

   **gift_pledge_confirmation**
   > Hi {{1}}, thank you for choosing to get {{2}} for our baby! You chose to send it on {{3}}.
   > Account details: {{4}}. Please use reference {{5}} as the transfer description.

   **gift_payment_reminder** (also used for the follow-up)
   > Hi {{1}}, this is a friendly reminder about your gift for our baby: {{2}}.
   > Please send it to {{3}} using reference {{4}}. Thank you so much!

   **gift_thank_you**
   > Hi {{1}}, we have received your gift ({{2}}). Thank you so much for your love and support! – {{3}}

   **gender_reveal_news**
   > Hi {{1}}, the secret is out: we are expecting {{2}}! {{3}} Come and see the registry: {{4}}

You can reword the templates as you like, as long as the number and order of `{{n}}` stay the
same.

### `'twilio'` (automatic, paid)
Fill in `account_sid`, `auth_token` and `from_number`. The Twilio sandbox number works for
testing (each guest has to join the sandbox first). For real use, Twilio needs an approved
WhatsApp sender, and messages sent outside a 24-hour chat window need approved templates.

Email is always sent either way, so WhatsApp is an extra.

## 9. Using the admin dashboard

| Page | What you can do |
| --- | --- |
| **Guesses & wishes** | Set the baby's gender (kept secret), press **🎉 Reveal now** on reveal day (this also emails/WhatsApps everyone who asked to be told; you can undo the reveal), see the boy/girl vote count, every suggested baby name and who guessed right, and hide or delete any wish from the wall. If WhatsApp is not set up, guests who only left a WhatsApp number are listed with a button each to send them the news by hand. |
| **Pledges** | Tabs: *Needs action* (due or overdue), Pending, Paid, Cancelled, All. Search by name, phone, email or reference. **✓ Mark paid** sends the thank-you. **Send reminder** sends it right now. **WhatsApp** opens a ready-written chat. |
| Pledge details (click a name) | Change the payment date (a new reminder is scheduled for the new date), add a private note, see every email/WhatsApp sent and whether it worked, cancel (frees up the gift), mark as not paid, delete. |
| **Gift items** | Add, edit, hide or delete gifts. Set price and quantity needed (e.g. 20 packs of diapers), upload a photo or use an emoji, choose a category and display order. Tick *Any amount* for a cash fund. |
| **Export CSV** | Download every pledge for Excel / Google Sheets. |

Each pledge gets a reference such as `BR-7K3QX9`. Guests are asked to use it as their transfer
description, so you can match payments in your bank app.

## 10. Changing the wording or look

- **Email / WhatsApp wording:** `includes/notifications.php` → `pledge_message()`.
- **Colours and fonts:** the variables at the top of `assets/css/style.css`. The page is dark,
  with a gold accent while the gender is a secret, then pink (girl) or blue (boy) after the reveal.
  Each theme has its own line (`[data-theme="girl"]` and so on).
- **Page text:** `includes/config.php` (`headline`, `intro`), plus the *How it works* section in
  `index.php`.

## 11. Security notes

- `includes/` and `database/` are blocked from the browser by `.htaccess`. Scripts cannot run in
  `uploads/`.
- All database queries use prepared statements. Admin forms are protected against CSRF, and the
  pledge form has a honeypot, a timing check and a per-IP hourly limit.
- Two people cannot claim the last item at the same time, because the item row is locked while a
  pledge is saved.
- Turn on **Force HTTPS** in hPanel → Security → SSL once your SSL certificate is active.

## 12. Troubleshooting

| Problem | Fix |
| --- | --- |
| "The registry is being set up" | The database details in `config.php` are wrong, or `schema.sql` was not imported. |
| Emails don't arrive | Open a pledge in the admin and check *Messages sent* for the error. Check the SMTP mailbox/password, and look in spam. |
| Reminders not sent | Check the cron job path. Open the web-key URL by hand to see its output. |
| Photo upload fails | Make sure the `uploads/` folder exists and is writable (permissions 755). |
| Wrong times/dates | Set `site.timezone` (default `Africa/Lagos`). |
