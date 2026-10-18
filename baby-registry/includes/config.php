<?php
/**
 * Baby Registry – settings.
 *
 * This is the ONLY file you need to edit to set the registry up.
 * Anything marked "CHANGE ME" must be filled in before going live.
 * This file is never sent to the browser, so passwords here are safe
 * (the includes/ folder is blocked by its own .htaccess).
 */

declare(strict_types=1);

// Never show PHP errors to visitors. Errors still go to the server error log.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

return [

    /* ---------------------------------------------------------------------
     * About the baby / the page
     * ------------------------------------------------------------------- */
    'site' => [
        // Full address of the registry, no trailing slash (used in emails), e.g.
        // 'https://yourdomain.com' or 'https://yourdomain.com/registry'.
        // Leave empty to detect it automatically.
        'url'          => '',

        'title'        => 'Baby Registry',
        'baby_name'    => 'Baby Uzorka',              // CHANGE ME
        'parents'      => 'Elvis & Partner Uzorka',   // CHANGE ME
        'headline'     => 'A little one is on the way!',
        'intro'        => "Thank you for celebrating with us. We have put together a few things that will help us "
                        . "welcome our little one. Pick a gift, choose the day you would like to send it, and we will "
                        . "remind you with our account details on that day. Your love and prayers mean the world to us.",
        // Due date or birthday (YYYY-MM-DD). Shown as a countdown. Leave empty to hide.
        'due_date'     => '2027-01-15',              // CHANGE ME
        'timezone'     => 'Africa/Lagos',
        'currency'     => '₦',
        // Latest payment date a guest may choose, counted in days from today.
        'max_days_ahead' => 365,
        // Show the bank details on the public page as well (not only in messages).
        'show_bank_on_page' => true,
    ],

    /* ---------------------------------------------------------------------
     * Database (hPanel > Databases > Management)
     * ------------------------------------------------------------------- */
    'db' => [
        'host'     => 'localhost',
        'name'     => 'u000000000_registry',   // CHANGE ME
        'user'     => 'u000000000_registry',   // CHANGE ME
        'password' => '',                      // CHANGE ME
    ],

    /* ---------------------------------------------------------------------
     * Where gifts should be paid. Sent in every reminder.
     * Add more than one account if you like.
     * ------------------------------------------------------------------- */
    'bank_accounts' => [
        [
            'bank_name'      => 'Your Bank',          // CHANGE ME
            'account_name'   => 'Your Account Name',  // CHANGE ME
            'account_number' => '0000000000',         // CHANGE ME
        ],
    ],

    /* ---------------------------------------------------------------------
     * Admin dashboard login (yourdomain.com/.../admin/)
     *
     * password_hash: open the admin page while this is empty, type the
     * password you want and it will show you a hash to paste here.
     * ------------------------------------------------------------------- */
    'admin' => [
        'username'      => 'admin',
        'password_hash' => '',   // CHANGE ME (see above)
        // New pledges are emailed to this address. Leave empty to turn off.
        'notify_email'  => '',   // CHANGE ME
    ],

    /* ---------------------------------------------------------------------
     * Email
     *
     * transport 'smtp' (recommended): uses a Hostinger mailbox.
     *   hPanel > Emails > create e.g. registry@yourdomain.com, then fill in
     *   username/password below. host smtp.hostinger.com, port 465, 'ssl'.
     * transport 'mail': PHP's built-in mail(); works without setup but is
     *   more likely to land in spam.
     * ------------------------------------------------------------------- */
    'mail' => [
        'transport'  => 'smtp',
        'from_email' => 'registry@yourdomain.com',   // CHANGE ME (must be a mailbox on your domain)
        'from_name'  => 'Baby Uzorka Registry',      // CHANGE ME
        'reply_to'   => '',                           // e.g. your personal email; empty = from_email
        'smtp' => [
            'host'       => 'smtp.hostinger.com',
            'port'       => 465,
            'encryption' => 'ssl',   // 'ssl' for 465, 'tls' for 587
            'username'   => 'registry@yourdomain.com',   // CHANGE ME
            'password'   => '',                           // CHANGE ME
            'timeout'    => 20,
        ],
    ],

    /* ---------------------------------------------------------------------
     * WhatsApp (optional)
     *
     * provider:
     *   'none'   – no automatic WhatsApp. The admin dashboard still shows a
     *              "WhatsApp" button that opens a ready-written chat for you
     *              to send yourself (free, no setup).
     *   'meta'   – WhatsApp Cloud API from Meta (free tier available).
     *              Needs approved message templates – see README.md.
     *   'twilio' – Twilio WhatsApp API (paid). See README.md.
     * ------------------------------------------------------------------- */
    'whatsapp' => [
        'provider' => 'none',
        // Used to turn local numbers like 0803… into +234803…
        'default_country_code' => '234',

        'meta' => [
            'access_token'    => '',
            'phone_number_id' => '',
            'api_version'     => 'v21.0',
            'language'        => 'en',
            // Template names exactly as approved in WhatsApp Manager.
            'templates' => [
                'confirmation' => 'gift_pledge_confirmation',
                'reminder'     => 'gift_payment_reminder',
                'followup'     => 'gift_payment_reminder',
                'thankyou'     => 'gift_thank_you',
            ],
        ],

        'twilio' => [
            'account_sid' => '',
            'auth_token'  => '',
            'from_number' => '',   // e.g. '+14155238886' (the Twilio sandbox number)
        ],
    ],

    /* ---------------------------------------------------------------------
     * Reminders (sent by cron/send-reminders.php – see README.md)
     * ------------------------------------------------------------------- */
    'reminders' => [
        // Send a second, gentle reminder this many days after the chosen date
        // if the gift is still not marked as paid. 0 turns it off.
        'followup_after_days' => 3,
        // Secret key for running the reminders from a web address instead of
        // a cron command: .../cron/send-reminders.php?key=THIS_VALUE
        // Use a long random string. Leave empty to allow command-line only.
        'web_key' => '',
    ],

    /* ---------------------------------------------------------------------
     * Spam protection for the pledge form
     * ------------------------------------------------------------------- */
    'limits' => [
        'min_seconds_to_submit' => 3,
        'max_pledges_per_hour_per_ip' => 10,
    ],
];
