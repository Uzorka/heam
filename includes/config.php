<?php
/**
 * Site configuration.
 *
 * Everything that is likely to change (contact details, social links,
 * domain, mail settings) lives here so the templates never need editing.
 */

declare(strict_types=1);

// Never show PHP errors to visitors. Errors are still written to the server log.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

date_default_timezone_set('Africa/Lagos');

return [

    'site' => [
        // Set this to your live domain once it is connected, e.g. 'https://www.jolleyaodugbo.com'
        // (no trailing slash). Leave empty to detect the domain automatically.
        'url'         => '',
        'name'        => 'Joll Eya Odugbo',
        'title'       => 'Joll Eya Odugbo | Web & Software Developer',
        'description' => 'Joll Eya Odugbo is an aspiring web and software developer from Delta State, Nigeria, '
                       . 'with skills in HTML, CSS, JavaScript, PHP, WordPress, React and Flutter.',
        'og_image'    => '/assets/images/og-image.png',
        'lang'        => 'en',
        'locale'      => 'en_NG',
    ],

    'person' => [
        'name'        => 'Joll Eya Odugbo',
        'headline'    => 'Aspiring Web & Software Developer',
        'email'       => 'Odugbojolly@gmail.com',
        'phone'       => '08101067789',
        'phone_intl'  => '+2348101067789', // Used for tel: links
        'location'    => 'Delta State, Nigeria',
        'region'      => 'Delta State',
        'country'     => 'NG',
    ],

    /*
     * Social profiles.
     * Leave a value empty ('') to hide it. Links appear on the site automatically
     * once a full URL is added, e.g. 'https://github.com/username'.
     */
    'social' => [
        'GitHub'    => '',
        'LinkedIn'  => '',
        'X'         => '',
        'Facebook'  => '',
        'Instagram' => '',
    ],

    /*
     * Contact form / mail settings.
     *
     * transport:
     *   'mail' - uses PHP's built-in mail() function (works on Hostinger out of the box).
     *   'smtp' - uses PHPMailer with the SMTP details below (more reliable delivery).
     *
     * HOSTINGER SMTP (optional, recommended once a domain email exists):
     *   1. In hPanel go to Emails > Email Accounts and create e.g. contact@yourdomain.com.
     *   2. Upload PHPMailer to includes/PHPMailer/ (see README.md, no Composer needed).
     *   3. Set 'transport' => 'smtp' and fill in the 'smtp' block:
     *        host: smtp.hostinger.com   port: 465   encryption: 'ssl'
     *        username: contact@yourdomain.com   password: the mailbox password
     *
     * The password is only ever read by PHP on the server; it is never sent to the browser.
     */
    'mail' => [
        'transport'  => 'mail',

        // Where contact form messages are delivered.
        'to_email'   => 'Odugbojolly@gmail.com',
        'to_name'    => 'Joll Eya Odugbo',

        // The "From" address. On Hostinger this should be an address on your own domain
        // (e.g. no-reply@yourdomain.com), otherwise messages may be rejected as spam.
        // Leave empty to use no-reply@<current domain>.
        'from_email' => '',
        'from_name'  => 'Portfolio Contact Form',

        'subject_prefix' => '[Portfolio] ',

        'smtp' => [
            'host'       => 'smtp.hostinger.com',
            'port'       => 465,
            'encryption' => 'ssl', // 'ssl' for port 465, 'tls' for port 587
            'username'   => '',
            'password'   => '',
        ],
    ],

    // Contact form spam / abuse limits.
    'contact' => [
        'min_seconds_to_submit' => 3,    // Faster submissions are treated as bots.
        'cooldown_seconds'      => 30,   // Minimum time between two messages from one visitor.
        'max_message_length'    => 5000,
        'max_links_in_message'  => 3,
    ],
];
