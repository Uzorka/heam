<?php
/**
 * Sends payment reminders. Run once a day with a Hostinger cron job:
 *
 *   hPanel > Advanced > Cron Jobs > "PHP" type, command:
 *   /home/u000000000/domains/yourdomain.com/public_html/registry/cron/send-reminders.php
 *
 * or from a web address (needs 'web_key' in config.php):
 *   https://yourdomain.com/registry/cron/send-reminders.php?key=YOUR_KEY
 *
 * It sends:
 *   - the reminder to every unpaid pledge whose payment date is today
 *     (or earlier, if a reminder was missed), and
 *   - one gentle follow-up N days later if it is still unpaid.
 * Running it more than once a day is safe – nobody gets a message twice.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';

$isCli = PHP_SAPI === 'cli';
if (!$isCli) {
    $key = registry_config()['reminders']['web_key'];
    if ($key === '' || !hash_equals($key, (string) ($_GET['key'] ?? ''))) {
        http_response_code(403);
        exit('Forbidden');
    }
    header('Content-Type: text/plain; charset=utf-8');
}

@set_time_limit(300);

/** Stops two overlapping runs from sending the same reminder twice. */
$lock = fopen(sys_get_temp_dir() . '/baby-registry-reminders-' . md5(REGISTRY_ROOT) . '.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    exit("Another reminder run is in progress.\n");
}

function out(string $line): void
{
    echo '[' . date('Y-m-d H:i:s') . '] ' . $line . "\n";
}

$select = PLEDGE_SELECT_SQL . ' WHERE ';

$jobs = [
    'reminder' => db()->query($select . "p.status = 'pending' AND p.reminder_sent_at IS NULL AND p.payment_date <= CURDATE() ORDER BY p.id")->fetchAll(),
];

$followDays = (int) registry_config()['reminders']['followup_after_days'];
if ($followDays > 0) {
    $stmt = db()->prepare($select . "p.status = 'pending' AND p.reminder_sent_at IS NOT NULL AND p.followup_sent_at IS NULL
                                     AND p.payment_date <= (CURDATE() - INTERVAL ? DAY)
                                     AND p.reminder_sent_at <= (NOW() - INTERVAL 1 DAY) ORDER BY p.id");
    $stmt->execute([$followDays]);
    $jobs['followup'] = $stmt->fetchAll();
}

$sent = 0;
foreach ($jobs as $type => $pledges) {
    foreach ($pledges as $pledge) {
        try {
            $results = notify_pledge($pledge, $type);
            $summary = [];
            foreach ($results as $channel => [$ok, $detail]) {
                $summary[] = $channel . ':' . ($ok ? 'ok' : 'FAILED ' . $detail);
            }
            out("{$type} {$pledge['reference']} {$pledge['full_name']} – " . ($summary ? implode(', ', $summary) : 'no channel'));
            $sent++;
        } catch (Throwable $e) {
            out("{$type} {$pledge['reference']} ERROR " . $e->getMessage());
        }
    }
}

// Catch up on reveal announcements that failed earlier (e.g. the mail server was down).
$news = send_reveal_notifications();
if ($news['sent'] || $news['failed']) {
    out("reveal news: {$news['sent']} sent, {$news['failed']} failed");
}

out("Done. {$sent} pledge(s) processed.");
flock($lock, LOCK_UN);
