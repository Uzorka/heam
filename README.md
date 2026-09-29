# Joll Eya Odugbo – Personal Portfolio

A single-page personal portfolio built with **HTML5, CSS3, vanilla JavaScript and PHP**.
There is no build step and no Node.js, npm, Composer or database: upload the files to Hostinger
and the site works straight away.

---

## Contents

1. [Requirements](#requirements)
2. [File structure](#file-structure)
3. [Deploying to Hostinger](#deploying-to-hostinger)
4. [Configuring the contact form](#configuring-the-contact-form)
5. [Editing content](#editing-content)
6. [Adding projects](#adding-projects)
7. [Adding social links](#adding-social-links)
8. [SEO checklist after going live](#seo-checklist-after-going-live)
9. [Local preview (optional)](#local-preview-optional)

---

## Requirements

| Item | Requirement |
| --- | --- |
| Hosting | Any Hostinger shared / web hosting plan (Apache or LiteSpeed) |
| PHP | **PHP 8.2 or 8.3 recommended.** Works on PHP 7.4 and newer. |
| PHP extensions | `mbstring`, `session`, `filter`, `json` (all enabled by default on Hostinger) |
| Database | None |
| Terminal / SSH | Not required |

---

## File structure

```
public_html/
├── index.php              Main page (all sections)
├── contact.php            Contact form handler (validation, spam checks, sending)
├── 404.php                "Page not found" page
├── .htaccess              Security headers, compression, caching, folder protection
├── robots.txt             Search engine rules
├── sitemap.xml            Sitemap for search engines
│
├── assets/
│   ├── css/style.css      All styles (colours are CSS variables at the top)
│   ├── js/main.js         Menu, dark mode, scroll effects, contact form
│   ├── images/
│   │   ├── og-image.png   Preview image for social media shares (1200 × 630)
│   │   ├── icons/         Favicons
│   │   ├── projects/      Project screenshots (add your own)
│   │   └── profile/       Profile photo (optional, not used yet)
│   └── fonts/             Optional self-hosted fonts (see "Fonts" below)
│
├── includes/              PHP building blocks (not accessible from the browser)
│   ├── config.php         Site settings, contact details, social links, mail settings
│   ├── bootstrap.php      Loads config + helpers
│   ├── functions.php      Small helper functions
│   ├── header.php         <head>, metadata and site header
│   ├── footer.php         Footer
│   ├── icons.php          Inline SVG icons
│   └── mailer.php         Sends email via PHP mail() or SMTP
│
└── data/                  Portfolio content as simple PHP arrays
    ├── skills.php
    ├── experience.php
    ├── education.php
    ├── strengths.php
    └── projects.php
```

---

## Deploying to Hostinger

1. **Log into Hostinger** at <https://hpanel.hostinger.com>.
2. **Open hPanel** and choose **Websites → Manage** next to your domain.
3. **Open File Manager** (under *Files → File Manager*).
4. **Enter the `public_html` folder.** Delete Hostinger's placeholder `default.php` or
   `index.html` if one is there.
5. **Upload the project.** The easiest way is to compress the project folder into a ZIP file
   on your computer, then click **Upload** in File Manager and select the ZIP.
6. **Extract the ZIP.** Right-click the uploaded ZIP → **Extract** → extract into `public_html`.
   Delete the ZIP afterwards.
7. **Check the location of `index.php`.** It must sit **directly inside `public_html`**
   (`public_html/index.php`), not in a sub-folder like `public_html/portfolio/index.php`.
   If it ended up in a sub-folder, open that folder, select everything, and use **Move** to
   move it all up into `public_html`.
   *Tip:* `.htaccess` is a hidden file. If you do not see it, enable "Show hidden files" in
   File Manager settings and confirm it was uploaded.
8. **Configure the PHP version (if required).** In hPanel go to
   **Advanced → PHP Configuration** and select **PHP 8.2** or **8.3**. Save.
9. **Configure the contact form.** Open `includes/config.php` in File Manager (right-click →
   **Edit**) and follow [Configuring the contact form](#configuring-the-contact-form) below.
10. **Enable SSL.** In hPanel go to **Security → SSL**, install the free SSL certificate for
    your domain if it is not already active, then turn on **Force HTTPS**.
11. **Test the domain.** Visit your domain in a browser and check:
    - The page loads and every menu link scrolls to the right section.
    - The mobile menu opens and closes on a phone.
    - The sun/moon button switches between light and dark mode.
    - Sending a message from the contact form shows a success message and the email arrives
      in the inbox (check the spam folder the first time).

No terminal, `npm install` or `composer install` is needed.

---

## Configuring the contact form

All settings are in **`includes/config.php`**.

### Option A – PHP `mail()` (default, works immediately)

1. In hPanel go to **Emails** and create a mailbox on your domain, for example
   `no-reply@yourdomain.com` (or `contact@yourdomain.com`).
2. In `includes/config.php`, set:

   ```php
   'from_email' => 'no-reply@yourdomain.com',
   ```

   Hostinger only reliably delivers mail sent **from an address on your own domain**. If this is
   left empty, the form uses `no-reply@<your domain>` automatically.
3. Messages are delivered to `to_email` (`Odugbojolly@gmail.com`). Clicking **Reply** in the
   received email replies directly to the visitor.

### Option B – Hostinger SMTP (recommended for best delivery)

1. Create a mailbox in hPanel (**Emails → Email Accounts**), e.g. `contact@yourdomain.com`.
2. Download PHPMailer from <https://github.com/PHPMailer/PHPMailer/releases> (the "Source code
   (zip)" file). Upload **only its `src` folder** to `includes/PHPMailer/`, so that this file
   exists: `includes/PHPMailer/src/PHPMailer.php`. No Composer needed.
3. In `includes/config.php` change the mail settings:

   ```php
   'transport' => 'smtp',
   ...
   'smtp' => [
       'host'       => 'smtp.hostinger.com',
       'port'       => 465,
       'encryption' => 'ssl',
       'username'   => 'contact@yourdomain.com',
       'password'   => 'your-mailbox-password',
   ],
   ```

The password stays on the server in a PHP file; it is never sent to the browser. The `includes`
folder is also blocked from direct browser access by `includes/.htaccess`.

### Built-in protection

The form handler (`contact.php`) includes:

- Server-side validation of every field (length limits, valid email address).
- Input sanitising and output escaping with `htmlspecialchars()`.
- Email header injection protection (line breaks are rejected in name, email and subject).
- A hidden **honeypot** field that bots fill in and people never see.
- A session token so only the form on this site can submit messages.
- A minimum time before submission and a short cooldown between messages.
- A limit on the number of links in a message.
- Friendly error messages only – technical details go to the server error log, never to visitors.

It works with JavaScript (the message sends without reloading the page) and without JavaScript
(the page reloads and shows the result).

---

## Editing content

| What | Where |
| --- | --- |
| Name, email, phone, location | `includes/config.php` → `person` |
| Page title, description, domain | `includes/config.php` → `site` |
| Skills | `data/skills.php` |
| Experience & service | `data/experience.php` |
| Education | `data/education.php` |
| Personal strengths | `data/strengths.php` |
| Projects | `data/projects.php` |
| Hero and About text | `index.php` (sections are clearly commented) |
| Colours | Top of `assets/css/style.css` (`:root` variables; dark mode block below) |

The experience entries accept optional `role`, `period` and `summary` fields that only appear
once filled in.

---

## Adding projects

Open `data/projects.php`. While the list is empty, the site shows *"Development projects will be
added here soon."* To publish a project, add an entry like this:

```php
return [
    [
        'title'        => 'Project name',
        'category'     => 'Website',
        'description'  => 'A short, honest description of what the project does.',
        'technologies' => ['HTML', 'CSS', 'JavaScript'],
        'image'        => 'assets/images/projects/project-name.jpg',
        'image_webp'   => 'assets/images/projects/project-name.webp', // optional
        'image_alt'    => 'Screenshot of the project home page',
        'live_url'     => 'https://example.com',                      // optional
        'github_url'   => 'https://github.com/username/project-name', // optional
    ],
];
```

- Upload screenshots to `assets/images/projects/` (ideal size **1200 × 750 px**, under 200 KB).
  A `.webp` copy loads faster; free converters such as <https://squoosh.app> can create one.
- The **Live Site** and **Source Code** buttons only appear when their URLs are filled in.
- Images are lazy-loaded automatically.

---

## Adding social links

In `includes/config.php`, fill in any of the `social` entries with a full URL:

```php
'social' => [
    'GitHub'   => 'https://github.com/username',
    'LinkedIn' => 'https://www.linkedin.com/in/username',
    ...
],
```

Empty entries stay hidden. Filled ones appear in the Contact section and footer, and are added
to the search engine data (`sameAs`) automatically.

---

## SEO checklist after going live

1. In `includes/config.php`, set `'url' => 'https://www.yourdomain.com'` (no trailing slash).
   This is used for the canonical URL and social-media preview image.
2. In `robots.txt` and `sitemap.xml`, replace `https://www.yourdomain.com` with your real domain.
3. Optionally submit the sitemap in Google Search Console.
4. Replace `assets/images/og-image.png` if you want a different social media preview
   (1200 × 630 px).
5. Replace the favicon files in `assets/images/icons/` if you want a different icon.

### Fonts

The site uses the **Inter** font from Google Fonts. To self-host it instead (one fewer external
request), download the `.woff2` files into `assets/fonts/`, add `@font-face` rules at the top of
`style.css`, and remove the three Google Fonts `<link>` lines in `includes/header.php`.

---

## Local preview (optional)

If PHP is installed on your computer you can preview the site before uploading:

```bash
php -S localhost:8000
```

Then open <http://localhost:8000>. (`.htaccess` rules only apply on the real server, and the
contact form needs a configured mail server to actually send.)
