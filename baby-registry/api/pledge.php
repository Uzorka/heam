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
$itemId   = (int) ($_POST['item_id'] ?? 0);
$fullName = trim(preg_replace('/\s+/', ' ', (string) ($_POST['full_name'] ?? '')));
$phoneRaw = trim((string) ($_POST['phone'] ?? ''));
$phone    = normalize_phone($phoneRaw);
$email    = trim((string) ($_POST['email'] ?? ''));
$whatsapp = !empty($_POST['whatsapp']);
$qty      = max(1, (int) ($_POST['quantity'] ?? 1));
$amountIn = (float) str_replace([',', ' '], '', (string) ($_POST['amount'] ?? '0'));
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

    $stmt = $pdo->prepare('SELECT * FROM items WHERE id = ? AND is_active = 1 FOR UPDATE');
    $stmt->execute([$itemId]);
    $item = $stmt->fetch();
    if (!$item) {
        $pdo->rollBack();
        json_response(['ok' => false, 'error' => 'That gift is no longer available.'], 404);
    }

    // Cash funds, and items without a set price, let the guest choose the amount.
    $chooseAmount = $item['is_open_amount'] || (float) $item['price'] <= 0;
    if ($chooseAmount) {
        $qty = 1;
        $amount = round($amountIn, 2);
        if ($amount < 100 || $amount > 100000000) {
            $pdo->rollBack();
            json_response(['ok' => false, 'error' => 'Please check the highlighted fields.',
                           'fields' => ['amount' => 'Please enter the amount you would like to give.']], 422);
        }
    }

    if (!$item['is_open_amount']) {
        $taken = $pdo->prepare("SELECT COALESCE(SUM(quantity), 0) FROM pledges WHERE item_id = ? AND status IN ('pending', 'paid')");
        $taken->execute([$itemId]);
        $remaining = (int) $item['quantity_needed'] - (int) $taken->fetchColumn();

        if ($remaining <= 0) {
            $pdo->rollBack();
            json_response(['ok' => false, 'error' => 'Someone has just picked the last one of this gift. Please choose another.'], 409);
        }
        if ($qty > $remaining) {
            $pdo->rollBack();
            json_response(['ok' => false, 'error' => "Only {$remaining} still needed – please lower the quantity.",
                           'fields' => ['quantity' => "Only {$remaining} still needed."]], 409);
        }
        if (!$chooseAmount) {
            $amount = round((float) $item['price'] * $qty, 2);
        }
    }

    $reference = new_pledge_reference();
    $pdo->prepare(
        'INSERT INTO pledges (reference, item_id, full_name, phone, email, notify_via, quantity, amount, payment_date, message, share_message, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $reference, $itemId, $fullName, $phone, $email, $whatsapp ? 'both' : 'email',
        $qty, $amount, $payDate->format('Y-m-d'), $message, $share ? 1 : 0, client_ip(),
    ]);
    $pledgeId = (int) $pdo->lastInsertId();
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

$updated = fetch_item($itemId);

json_response([
    'ok'        => true,
    'reference' => $reference,
    'item'      => [
        'id'        => $updated['id'],
        'remaining' => $updated['is_open_amount'] ? null : $updated['remaining'],
        'pledged'   => $updated['pledged_qty'],
    ],
    'summary'   => [
        'gift'         => pledge_summary($pledge)['label'],
        'amount'       => money((float) $pledge['amount']),
        'payment_date' => nice_date($pledge['payment_date']),
        'date_iso'     => $pledge['payment_date'],
        'is_today'     => $pledge['payment_date'] <= date('Y-m-d'),
        'email_sent'   => (bool) ($sent['email'][0] ?? false),
    ],
]);
