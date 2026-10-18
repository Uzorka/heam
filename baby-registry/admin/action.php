<?php
/**
 * Handles every button on the pledge pages (always POST + CSRF token).
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';
require_admin();
require_post_csrf();

$id     = (int) ($_POST['id'] ?? 0);
$action = (string) ($_POST['action'] ?? '');
$return = safe_return($_POST['return'] ?? null);
$pledge = fetch_pledge($id);

if (!$pledge) {
    flash('error', 'That pledge no longer exists.');
    redirect($return);
}

/** Turns per-channel send results into a short sentence for the flash message. */
function describe_results(array $results): string
{
    if (!$results) {
        return 'No email or WhatsApp could be sent (no channel available).';
    }
    $parts = [];
    foreach ($results as $channel => [$ok, $detail]) {
        $parts[] = ($channel === 'email' ? 'Email' : 'WhatsApp') . ($ok ? ' sent' : ' failed (' . $detail . ')');
    }
    return implode(', ', $parts) . '.';
}

/** Offer the click-to-chat button when WhatsApp is not sent automatically. */
function whatsapp_links(array $pledge, string $type): array
{
    if (whatsapp_enabled() && $pledge['notify_via'] === 'both') {
        return [];
    }
    return [['label' => 'Send on WhatsApp', 'href' => pledge_whatsapp_link($pledge, $type)]];
}

$pdo = db();

switch ($action) {
    case 'mark_paid':
        $pdo->prepare("UPDATE pledges SET status = 'paid', paid_at = NOW() WHERE id = ?")->execute([$id]);
        $pledge = fetch_pledge($id);
        $results = notify_pledge($pledge, 'thankyou');
        flash('success', "Marked as paid. Thank-you message: " . describe_results($results), whatsapp_links($pledge, 'thankyou'));
        break;

    case 'mark_unpaid':
        $pdo->prepare("UPDATE pledges SET status = 'pending', paid_at = NULL WHERE id = ?")->execute([$id]);
        flash('info', 'Marked as not paid.');
        break;

    case 'send_reminder':
        $results = notify_pledge($pledge, 'reminder');
        flash('success', 'Reminder: ' . describe_results($results), whatsapp_links($pledge, 'reminder'));
        break;

    case 'send_thankyou':
        $results = notify_pledge($pledge, 'thankyou');
        flash('success', 'Thank-you: ' . describe_results($results), whatsapp_links($pledge, 'thankyou'));
        break;

    case 'cancel':
        $pdo->prepare("UPDATE pledges SET status = 'cancelled' WHERE id = ?")->execute([$id]);
        flash('info', 'Pledge cancelled. The gift is available on the registry again.');
        break;

    case 'restore':
        $item = fetch_item((int) $pledge['item_id']);
        if (!$item['is_open_amount'] && $item['remaining'] < (int) $pledge['quantity']) {
            flash('error', 'Cannot restore: someone else has already pledged this gift.');
            break;
        }
        $pdo->prepare("UPDATE pledges SET status = 'pending' WHERE id = ?")->execute([$id]);
        flash('info', 'Pledge restored to pending.');
        break;

    case 'update':
        $date = (string) ($_POST['payment_date'] ?? '');
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if (!$d || $d->format('Y-m-d') !== $date) {
            flash('error', 'Please enter a valid date.');
            break;
        }
        $note = mb_substr(trim((string) ($_POST['admin_note'] ?? '')), 0, 500);
        // A new date means a new reminder should go out on that day.
        $resetReminder = $date !== $pledge['payment_date'];
        $pdo->prepare(
            'UPDATE pledges SET payment_date = ?, admin_note = ?'
            . ($resetReminder ? ', reminder_sent_at = NULL, followup_sent_at = NULL' : '')
            . ' WHERE id = ?'
        )->execute([$date, $note, $id]);
        flash('success', 'Pledge updated.');
        break;

    case 'delete':
        $pdo->prepare('DELETE FROM notification_log WHERE pledge_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM pledges WHERE id = ?')->execute([$id]);
        flash('info', 'Pledge deleted.');
        redirect('index.php');

    default:
        flash('error', 'Unknown action.');
}

redirect($return);
