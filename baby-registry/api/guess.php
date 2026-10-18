<?php
/**
 * Records a visitor's boy/girl guess and returns the live tally.
 * Called by assets/js/registry.js (POST, JSON response).
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
start_secure_session();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'Method not allowed'], 405);
}
if (!csrf_valid($_POST['token'] ?? null)) {
    json_response(['ok' => false, 'error' => 'Your session expired. Please refresh the page.'], 400);
}
if (($_POST['website'] ?? '') !== '') {
    json_response(['ok' => false, 'error' => 'Please try again.'], 400);
}

$guess   = (string) ($_POST['guess'] ?? '');
$name    = mb_substr(trim(preg_replace('/\s+/', ' ', (string) ($_POST['name'] ?? ''))), 0, 60);
$message = mb_substr(trim((string) ($_POST['message'] ?? '')), 0, 300);
$babyName = mb_substr(trim(preg_replace('/\s+/', ' ', (string) ($_POST['baby_name'] ?? ''))), 0, 60);
$email   = trim((string) ($_POST['email'] ?? ''));
$phoneIn = trim((string) ($_POST['phone'] ?? ''));
$phone   = $phoneIn === '' ? '' : normalize_phone($phoneIn);

if (!in_array($guess, ['boy', 'girl'], true)) {
    json_response(['ok' => false, 'error' => 'Please choose boy or girl.'], 422);
}
// Contact details are optional; they are only used to announce the reveal.
$fields = [];
if ($email !== '' && (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 190)) {
    $fields['email'] = 'Please check your email address, or leave it empty.';
}
if ($phoneIn !== '' && $phone === '') {
    $fields['phone'] = 'Please check your WhatsApp number, or leave it empty.';
}
if ($fields) {
    json_response(['ok' => false, 'error' => 'Please check the highlighted fields.', 'fields' => $fields], 422);
}

$visitor = visitor_id();

try {
    $state = reveal_state();
    $existing = visitor_guess($visitor);

    // Guesses are only counted while the gender is still a secret, once per visitor.
    if (!$state['revealed'] && !$existing) {
        $recent = db()->prepare('SELECT COUNT(*) FROM gender_guesses WHERE ip_address = ? AND created_at > (NOW() - INTERVAL 1 HOUR)');
        $recent->execute([client_ip()]);
        if ((int) $recent->fetchColumn() >= 30) {
            json_response(['ok' => false, 'error' => 'Lots of guesses from this connection – please try again later.'], 429);
        }

        db()->prepare(
            'INSERT IGNORE INTO gender_guesses (guess, name, baby_name, message, email, phone, visitor_id, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$guess, $name, $babyName, $message, $email, $phone, $visitor, client_ip()]);
        $existing = ['guess' => $guess, 'name' => $name];
    }

    json_response([
        'ok'      => true,
        'guess'   => $existing['guess'] ?? $guess,
        'counted' => !$state['revealed'],
        'notify'  => $email !== '' || $phone !== '',
        'tally'   => guess_tally(),
        'reveal'  => $state,
    ]);
} catch (Throwable $e) {
    error_log('Registry guess error: ' . $e->getMessage());
    json_response(['ok' => false, 'error' => 'Sorry, something went wrong. Please try again.'], 500);
}
