<?php
/**
 * Downloads every pledge as a CSV file (opens in Excel / Google Sheets).
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';
require_admin();

$rows = db()->query(
    "SELECT p.reference, p.full_name, p.phone, p.email,
            (SELECT GROUP_CONCAT(i.name ORDER BY i.sort_order SEPARATOR ', ') FROM pledge_items pi
               JOIN items i ON i.id = pi.item_id WHERE pi.pledge_id = p.id) AS gifts,
            p.amount, p.payment_date,
            p.status, p.paid_at, p.reminder_sent_at, p.thankyou_sent_at, p.message, p.admin_note, p.created_at
     FROM pledges p ORDER BY p.created_at"
)->fetchAll();

header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="registry-pledges-' . date('Y-m-d') . '.csv"');

$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel shows ₦ and accents correctly.
fputcsv($out, ['Reference', 'Full name', 'Phone', 'Email', 'Gifts', 'Est. value', 'Payment date',
               'Status', 'Paid at', 'Reminder sent', 'Thank-you sent', 'Message', 'Note', 'Pledged at']);
foreach ($rows as $row) {
    $row['phone'] = display_phone($row['phone']);
    // Stop spreadsheet apps from treating guest text as a formula.
    $row = array_map(static fn($v) => is_string($v) && preg_match('/^[=@\-]/', $v) ? "'" . $v : $v, $row);
    fputcsv($out, array_values($row));
}
fclose($out);
