<?php
/**
 * Saves a gift pledge from the registry page and sends the confirmation.
 * Called by assets/js/registry.js (POST, JSON response).
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
start_secure_session();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'Method not allowed'], 405);
}

$limits = registry_config()['limits'];
$site   = registry_config()['site'];

if (!csrf_valid($_POST['token'] ?? null)) {
    json_response(['ok' => false, 'error' => 'Your session expired. Please refresh the page and try again.'], 400);
}

// Spam checks: hidden field must stay empty and the form must not be submitted instantly.
$formTime = (int) ($_SESSION['form_time'] ?? 0);
if (($_POST['website'] ?? '') !== '' || ($formTime && time() - $formTime < $limits['min_seconds_to_submit'])) {
    json_response(['ok' => false, 'error' => 'Please wait a moment and try again.'], 400);
}

// ---- Validate ---------------------------------------------------------------

$errors   = [];
// One or more items, sent as item_ids[] (max 60, duplicates ignored).
$itemIds  = array_slice(array_values(array_unique(array_filter(array_map('intval', (array) ($_POST['item_ids'] ?? []))))), 0, 60);
$fullName = trim(preg_replace('/\s+/', ' ', (string) ($_POST['full_name'] ?? '')));
$phoneRaw = trim((string) ($_POST['phone'] ?? ''));
$phone    = normalize_phone($phoneRaw);
$email    = trim((string) ($_POST['email'] ?? ''));
$whatsapp = !empty($_POST['whatsapp']);
$dateRaw  = (string) ($_POST['payment_date'] ?? '');
$message  = trim((string) ($_POST['message'] ?? ''));
$share    = !empty($_POST['share_message']) && $message !== '';

if (mb_strlen($fullName) < 3 || mb_strlen($fullName) > 120 || !str_contains($fullName, ' ')) {
    $errors['full_name'] = 'Please enter your full name (first and last name).';
}
if ($phone === '') {
    $errors['phone'] = 'Please enter a valid phone number.';
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 190) {
    $errors['email'] = 'Please enter a valid email address.';
}

$today   = new DateTimeImmutable('today');
$payDate = DateTimeImmutable::createFromFormat('!Y-m-d', $dateRaw);
if (!$payDate || $payDate->format('Y-m-d') !== $dateRaw) {
    $errors['payment_date'] = 'Please choose the date you would like to pay.';
} elseif ($payDate < $today) {
    $errors['payment_date'] = 'Please choose today or a future date.';
} elseif ($payDate > $today->modify('+' . (int) $site['max_days_ahead'] . ' days')) {
    $errors['payment_date'] = 'Please choose a date within the next ' . (int) $site['max_days_ahead'] . ' days.';
}
if (mb_strlen($message) > 1000) {
    $errors['message'] = 'Your message is a little too long (1000 characters max).';
}

if ($errors) {
    json_response(['ok' => false, 'error' => 'Please check the highlighted fields.', 'fields' => $errors], 422);
}

// ---- Save (locking the item so two people cannot take the last one) --------

$pdo = db();

try {
    $ipCheck = $pdo->prepare('SELECT COUNT(*) FROM pledges WHERE ip_address = ? AND created_at > (NOW() - INTERVAL 1 HOUR)');
    $ipCheck->execute([client_ip()]);
    if ((int) $ipCheck->fetchColumn() >= $limits['max_pledges_per_hour_per_ip']) {
        json_response(['ok' => false, 'error' => 'Too many pledges from this connection. Please try again later.'], 429);
    }

    $pdo->beginTransaction();

    if (!$itemIds) {
        $pdo->rollBack();
        json_response(['ok' => false, 'error' => 'Please choose at least one gift.'], 422);
    }

    // Lock the chosen items so two guests cannot take the last of something at once.
    $marks = implode(',', array_fill(0, count($itemIds), '?'));
    $stmt  = $pdo->prepare("SELECT * FROM items WHERE id IN ({$marks}) AND is_active = 1 ORDER BY sort_order, id FOR UPDATE");
    $stmt->execute($itemIds);
    $locked = $stmt->fetchAll();
    // Counted only after the lock is held, so it includes any pledge committed just before.
    $count = $pdo->prepare("SELECT pi.item_id, COUNT(*) FROM pledge_items pi JOIN pledges p ON p.id = pi.pledge_id
                            WHERE pi.item_id IN ({$marks}) AND p.status IN ('pending', 'paid') GROUP BY pi.item_id");
    $count->execute($itemIds);
    $taken = $count->fetchAll(PDO::FETCH_KEY_PAIR);
    $items = array_map(static fn($i) => decorate_item($i + ['pledged_qty' => $taken[$i['id']] ?? 0]), $locked);

    $gone = array_merge(
        array_diff($itemIds, array_column($items, 'id')),
        array_column(array_filter($items, static fn($i) => $i['remaining'] <= 0), 'id')
    );
    if ($gone) {
        $pdo->rollBack();
        $names = array_column(array_filter($items, static fn($i) => in_array($i['id'], $gone, true)), 'name');
        json_response([
            'ok'    => false,
            'error' => ($names ? implode(', ', $names) : 'One of your gifts') . ' has just been picked by someone else. '
                     . 'We have taken it off your list – please check and confirm again.',
            'gone'  => array_values(array_map('intval', $gone)),
        ], 409);
    }

    // The stored amount is the items' private estimate (admin only; may be 0).
    $amount = round(array_sum(array_column($items, 'price')), 2);

    $reference = new_pledge_reference();
    $pdo->prepare(
        'INSERT INTO pledges (reference, full_name, phone, email, notify_via, amount, payment_date, message, share_message, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $reference, $fullName, $phone, $email, $whatsapp ? 'both' : 'email',
        $amount, $payDate->format('Y-m-d'), $message, $share ? 1 : 0, client_ip(),
    ]);
    $pledgeId = (int) $pdo->lastInsertId();
    $link = $pdo->prepare('INSERT INTO pledge_items (pledge_id, item_id) VALUES (?, ?)');
    foreach ($items as $item) {
        $link->execute([$pledgeId, $item['id']]);
    }
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('Registry pledge error: ' . $e->getMessage());
    json_response(['ok' => false, 'error' => 'Sorry, something went wrong. Please try again.'], 500);
}

// Allow the next pledge from this visitor without reloading.
$_SESSION['form_time'] = time() - $limits['min_seconds_to_submit'];

// ---- Notify -----------------------------------------------------------------

$pledge = fetch_pledge($pledgeId);
$sent = [];
try {
    $sent = notify_pledge($pledge, 'confirmation');
    notify_admin_new_pledge($pledge);
} catch (Throwable $e) {
    error_log('Registry notify error: ' . $e->getMessage());
}

$updated = array_map(static function (int $id): array {
    $item = fetch_item($id);
    return ['id' => $id, 'remaining' => $item['is_open_amount'] ? null : $item['remaining']];
}, $itemIds);

json_response([
    'ok'        => true,
    'reference' => $reference,
    'items'     => $updated,
    'summary'   => [
        'gift'         => pledge_summary($pledge)['label'],
        'gifts'        => pledge_items_list($pledge),
        'payment_date' => nice_date($pledge['payment_date']),
        'date_iso'     => $pledge['payment_date'],
        'is_today'     => $pledge['payment_date'] <= date('Y-m-d'),
        'email_sent'   => (bool) ($sent['email'][0] ?? false),
    ],
    'calendar'  => calendar_links($pledge),
]);
