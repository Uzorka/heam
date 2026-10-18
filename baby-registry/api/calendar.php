<?php
/**
 * Serves a pledge's payment day as a calendar event (.ics).
 * Opened from the "Add to my calendar" button: iPhones and Macs show the
 * "Add to Calendar" prompt straight away instead of downloading a file.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';

$ref = strtoupper((string) ($_GET['ref'] ?? ''));
if (!preg_match('/^BR-[A-Z0-9]{6}$/', $ref)) {
    http_response_code(404);
    exit('Not found');
}

try {
    $stmt = db()->prepare(PLEDGE_SELECT_SQL . " WHERE p.reference = ? AND p.status <> 'cancelled'");
    $stmt->execute([$ref]);
    $pledge = $stmt->fetch();
} catch (Throwable $e) {
    error_log('Registry calendar error: ' . $e->getMessage());
    $pledge = null;
}
if (!$pledge) {
    http_response_code(404);
    exit('Not found');
}

header('Content-Type: text/calendar; charset=utf-8');
header('Content-Disposition: inline; filename="gift-reminder.ics"');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
echo calendar_ics($pledge);
