<?php
/**
 * Contact form handler.
 *
 * Works in two modes:
 *  - JavaScript (fetch) requests receive a JSON response.
 *  - Plain form posts (JavaScript disabled) are redirected back to the
 *    contact section with the result stored in the session.
 */

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
require __DIR__ . '/includes/mailer.php';

header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');

$wantsJson = stripos($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json') !== false;

/**
 * Sends the response in the format the browser expects and stops the script.
 */
function respond(bool $wantsJson, bool $success, string $message, array $errors = [], array $old = [], int $status = 200): void
{
    if ($wantsJson) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => $success,
            'message' => $message,
            'errors'  => (object) $errors,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $_SESSION['contact_flash'] = [
        'status'  => $success ? 'success' : 'error',
        'message' => $message,
        'errors'  => $errors,
        'old'     => $success ? [] : $old,
    ];
    header('Location: /#contact', true, 303);
    exit;
}

function text_length(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
}

/** Cleans a single-line field (name, email, subject). */
function clean_line(string $value): string
{
    $value = strip_tags($value);
    $value = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value) ?? '';
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';
    return trim($value);
}

/** Cleans the multi-line message, keeping line breaks and tabs. */
function clean_message(string $value): string
{
    $value = str_replace(["\r\n", "\r"], "\n", $value);
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    $value = preg_replace("/\n{3,}/", "\n\n", $value) ?? '';
    return trim($value);
}

/** True if the value contains anything that could be used for email header injection. */
function has_header_injection(string $value): bool
{
    return (bool) preg_match('/[\r\n]|%0a|%0d/i', $value);
}

// Only accept POST requests.
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    if ($wantsJson) {
        header('Allow: POST');
        respond(true, false, 'Invalid request.', [], [], 405);
    }
    header('Location: /#contact', true, 303);
    exit;
}

$contactConfig = $config['contact'];
$genericError  = 'Sorry, your message could not be sent right now. Please try again later, or email '
               . $config['person']['email'] . ' directly.';

$raw = [
    'name'    => is_string($_POST['name'] ?? null) ? $_POST['name'] : '',
    'email'   => is_string($_POST['email'] ?? null) ? $_POST['email'] : '',
    'subject' => is_string($_POST['subject'] ?? null) ? $_POST['subject'] : '',
    'message' => is_string($_POST['message'] ?? null) ? $_POST['message'] : '',
];

// Values used to refill the form after an error (escaped again when printed).
$old = [
    'name'    => clean_line($raw['name']),
    'email'   => clean_line($raw['email']),
    'subject' => clean_line($raw['subject']),
    'message' => clean_message($raw['message']),
];

// 1. Honeypot: real visitors never see this field. Pretend it worked so bots move on.
if (!empty($_POST['website'])) {
    respond($wantsJson, true, 'Thank you. Your message has been sent.');
}

// 2. Session token: blocks requests that did not come from the form on this site.
$token = is_string($_POST['token'] ?? null) ? $_POST['token'] : '';
if (empty($_SESSION['contact_token']) || !hash_equals($_SESSION['contact_token'], $token)) {
    respond($wantsJson, false, 'Your session has expired. Please refresh the page and try again.', [], $old, 400);
}

// 3. Timing: forms submitted within a few seconds of loading are almost always bots.
$formTime = (int) ($_SESSION['contact_form_time'] ?? 0);
if ($formTime > 0 && (time() - $formTime) < (int) $contactConfig['min_seconds_to_submit']) {
    respond($wantsJson, false, 'That was a little quick. Please wait a moment and try again.', [], $old, 429);
}

// 4. Cooldown between messages from the same visitor.
$lastSent = (int) ($_SESSION['contact_last_sent'] ?? 0);
if ($lastSent > 0 && (time() - $lastSent) < (int) $contactConfig['cooldown_seconds']) {
    respond($wantsJson, false, 'Your previous message was just sent. Please wait a little before sending another.', [], $old, 429);
}

// 5. Validation.
$errors = [];

if (has_header_injection($raw['name'])) {
    $errors['name'] = 'Please enter your name on a single line.';
} elseif (text_length($old['name']) < 2 || text_length($old['name']) > 100) {
    $errors['name'] = 'Please enter your full name (2–100 characters).';
}

if (has_header_injection($raw['email'])) {
    $errors['email'] = 'Please enter a valid email address.';
} elseif ($old['email'] === '' || strlen($old['email']) > 254 || !filter_var($old['email'], FILTER_VALIDATE_EMAIL)) {
    $errors['email'] = 'Please enter a valid email address.';
}

if (has_header_injection($raw['subject'])) {
    $errors['subject'] = 'Please enter the subject on a single line.';
} elseif (text_length($old['subject']) < 3 || text_length($old['subject']) > 150) {
    $errors['subject'] = 'Please enter a subject (3–150 characters).';
}

$maxMessage = (int) $contactConfig['max_message_length'];
if (text_length($old['message']) < 10) {
    $errors['message'] = 'Please enter a message of at least 10 characters.';
} elseif (text_length($old['message']) > $maxMessage) {
    $errors['message'] = 'Your message is too long (maximum ' . number_format($maxMessage) . ' characters).';
} elseif (preg_match_all('~https?://|www\.~i', $old['message']) > (int) $contactConfig['max_links_in_message']) {
    $errors['message'] = 'Please include fewer links in your message.';
}

if ($errors) {
    respond($wantsJson, false, 'Please correct the highlighted fields and try again.', $errors, $old, 422);
}

// 6. Send.
if (!send_contact_message($config['mail'], $old)) {
    error_log('Contact form: message could not be handed to the mail server.');
    respond($wantsJson, false, $genericError, [], $old, 500);
}

$_SESSION['contact_last_sent'] = time();
session_regenerate_id(true);

respond($wantsJson, true, 'Thank you. Your message has been sent and I will get back to you soon.');
