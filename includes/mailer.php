<?php
/**
 * Sends contact form messages.
 *
 * The transport is chosen in includes/config.php ('mail' or 'smtp'), so switching
 * to Hostinger SMTP later only requires a config change plus uploading PHPMailer.
 */

declare(strict_types=1);

/**
 * @param array $mailConfig The 'mail' block from config.php.
 * @param array $message    Validated fields: name, email, subject, message.
 * @return bool True when the mail was handed to the mail server.
 */
function send_contact_message(array $mailConfig, array $message): bool
{
    $fromEmail = $mailConfig['from_email'] ?: 'no-reply@' . preg_replace('/^www\./', '', preg_replace('/:\d+$/', '', current_host()));
    $subject   = $mailConfig['subject_prefix'] . $message['subject'];
    $body      = build_contact_body($message);

    if (($mailConfig['transport'] ?? 'mail') === 'smtp') {
        return send_with_smtp($mailConfig, $fromEmail, $subject, $body, $message);
    }

    return send_with_mail_function($mailConfig, $fromEmail, $subject, $body, $message);
}

function build_contact_body(array $message): string
{
    return "You have received a new message from your portfolio website.\n\n"
         . "Name:    {$message['name']}\n"
         . "Email:   {$message['email']}\n"
         . "Subject: {$message['subject']}\n"
         . 'Sent:    ' . date('j F Y, H:i T') . "\n\n"
         . "Message:\n"
         . "--------------------------------------------\n"
         . $message['message'] . "\n"
         . "--------------------------------------------\n\n"
         . "Reply directly to this email to respond to {$message['name']}.\n";
}

/** Encodes a header value (name or subject) so non-ASCII characters are safe. */
function encode_mail_header(string $value): string
{
    return function_exists('mb_encode_mimeheader')
        ? mb_encode_mimeheader($value, 'UTF-8', 'B', "\r\n")
        : '=?UTF-8?B?' . base64_encode($value) . '?=';
}

function send_with_mail_function(array $mailConfig, string $fromEmail, string $subject, string $body, array $message): bool
{
    // All values below were validated in contact.php to contain no line breaks,
    // so they cannot be used to inject extra headers.
    $headers = [
        'From: ' . encode_mail_header($mailConfig['from_name']) . ' <' . $fromEmail . '>',
        'Reply-To: ' . encode_mail_header($message['name']) . ' <' . $message['email'] . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'X-Mailer: PHP',
    ];

    $to = $mailConfig['to_email'];

    // The "-f" envelope sender improves deliverability on most shared hosts.
    $params = filter_var($fromEmail, FILTER_VALIDATE_EMAIL) ? '-f' . $fromEmail : '';

    return @mail($to, encode_mail_header($subject), $body, implode("\r\n", $headers), $params);
}

/**
 * SMTP via PHPMailer (https://github.com/PHPMailer/PHPMailer).
 * Upload the library's "src" folder to includes/PHPMailer/src/, or install it with
 * Composer (vendor/autoload.php is picked up automatically).
 */
function send_with_smtp(array $mailConfig, string $fromEmail, string $subject, string $body, array $message): bool
{
    $root = dirname(__DIR__);
    if (is_file($root . '/vendor/autoload.php')) {
        require_once $root . '/vendor/autoload.php';
    } elseif (is_file(__DIR__ . '/PHPMailer/src/PHPMailer.php')) {
        require_once __DIR__ . '/PHPMailer/src/Exception.php';
        require_once __DIR__ . '/PHPMailer/src/PHPMailer.php';
        require_once __DIR__ . '/PHPMailer/src/SMTP.php';
    }

    if (!class_exists('PHPMailer\\PHPMailer\\PHPMailer')) {
        error_log('Contact form: SMTP transport selected but PHPMailer was not found.');
        return false;
    }

    $smtp = $mailConfig['smtp'];
    try {
        $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
        $mail->isSMTP();
        $mail->Host       = $smtp['host'];
        $mail->Port       = (int) $smtp['port'];
        $mail->SMTPAuth   = true;
        $mail->Username   = $smtp['username'];
        $mail->Password   = $smtp['password'];
        $mail->SMTPSecure = $smtp['encryption'] === 'tls'
            ? \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS
            : \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;
        $mail->CharSet    = 'UTF-8';

        // With SMTP the From address should be the authenticated mailbox.
        $mail->setFrom($smtp['username'] ?: $fromEmail, $mailConfig['from_name']);
        $mail->addAddress($mailConfig['to_email'], $mailConfig['to_name']);
        $mail->addReplyTo($message['email'], $message['name']);
        $mail->Subject = $subject;
        $mail->Body    = $body;

        return $mail->send();
    } catch (\Throwable $exception) {
        error_log('Contact form SMTP error: ' . $exception->getMessage());
        return false;
    }
}
