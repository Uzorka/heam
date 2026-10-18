<?php
/**
 * Admin dashboard: every pledge, with quick actions.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';
require_admin();

$filters = [
    'action'    => 'Needs action',
    'pending'   => 'Pending',
    'paid'      => 'Paid',
    'cancelled' => 'Cancelled',
    'all'       => 'All',
];
$filter = array_key_exists($_GET['filter'] ?? '', $filters) ? $_GET['filter'] : 'action';
$search = trim((string) ($_GET['q'] ?? ''));

$where  = [];
$params = [];
switch ($filter) {
    case 'action':
        $where[] = "p.status = 'pending' AND p.payment_date <= CURDATE()";
        break;
    case 'pending':
    case 'paid':
    case 'cancelled':
        $where[] = 'p.status = ?';
        $params[] = $filter;
        break;
}
if ($search !== '') {
    $where[] = '(p.full_name LIKE ? OR p.phone LIKE ? OR p.email LIKE ? OR p.reference LIKE ? OR i.name LIKE ?)';
    $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $search) . '%';
    // Local numbers are stored internationally (0803… → 234803…), so drop a leading 0.
    $digits = ltrim(preg_replace('/\D/', '', $search), '0');
    array_push($params, $like, $digits !== '' ? '%' . $digits . '%' : $like, $like, $like, $like);
}

$sql = 'SELECT p.*, i.name AS item_name, i.emoji AS item_emoji, i.price AS item_price, i.is_open_amount
        FROM pledges p JOIN items i ON i.id = p.item_id'
     . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
     . " ORDER BY FIELD(p.status, 'pending', 'paid', 'cancelled'), p.payment_date, p.id DESC";
$stmt = db()->prepare($sql);
$stmt->execute($params);
$pledges = $stmt->fetchAll();

$stats = db()->query(
    "SELECT
        SUM(status = 'pending')                                  AS pending,
        SUM(status = 'pending' AND payment_date <= CURDATE())    AS due,
        SUM(status = 'paid')                                     AS paid,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0)    AS paid_amount,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending_amount
     FROM pledges"
)->fetch();

$token = csrf_token();
$returnTo = 'index.php?' . http_build_query(array_filter(['filter' => $filter, 'q' => $search]));

admin_header('Pledges', 'index.php');
?>
<div class="stats">
    <div class="stat"><span>Received</span><strong><?= e(money((float) $stats['paid_amount'])) ?></strong><small><?= (int) $stats['paid'] ?> gifts paid</small></div>
    <div class="stat"><span>Promised</span><strong><?= e(money((float) $stats['pending_amount'])) ?></strong><small><?= (int) $stats['pending'] ?> gifts pending</small></div>
    <div class="stat stat-alert"><span>Due or overdue</span><strong><?= (int) $stats['due'] ?></strong><small>waiting for payment</small></div>
</div>

<div class="toolbar">
    <nav class="tabs">
        <?php foreach ($filters as $key => $label): ?>
            <a href="?filter=<?= $key ?><?= $search !== '' ? '&q=' . urlencode($search) : '' ?>" class="<?= $filter === $key ? 'is-active' : '' ?>"><?= $label ?></a>
        <?php endforeach; ?>
    </nav>
    <form class="search" method="get">
        <input type="hidden" name="filter" value="<?= e($filter) ?>">
        <input type="search" name="q" value="<?= e($search) ?>" placeholder="Search name, phone, reference…">
    </form>
    <a class="btn btn-ghost btn-sm" href="export.php">Export CSV</a>
</div>

<?php if (!$pledges): ?>
    <p class="empty"><?= $filter === 'action' ? 'Nothing needs your attention right now. 🎉' : 'No pledges found.' ?></p>
<?php else: ?>
<div class="table-wrap">
<table class="table">
    <thead>
        <tr><th>Guest</th><th>Gift</th><th>Amount</th><th>Pay date</th><th>Status</th><th>Reminders</th><th class="right">Actions</th></tr>
    </thead>
    <tbody>
    <?php foreach ($pledges as $p): $sum = pledge_summary($p); ?>
        <tr>
            <td data-label="Guest">
                <a class="strong" href="pledge.php?id=<?= (int) $p['id'] ?>"><?= e($p['full_name']) ?></a>
                <div class="muted small"><?= e(display_phone($p['phone'])) ?> · <?= e($p['email']) ?></div>
                <div class="muted small"><?= e($p['reference']) ?></div>
            </td>
            <td data-label="Gift"><?= e($p['item_emoji'] . ' ' . $sum['label']) ?></td>
            <td data-label="Amount" class="nowrap"><?= e($sum['amount']) ?></td>
            <td data-label="Pay date" class="nowrap"><?= e(date('j M Y', strtotime($p['payment_date']))) ?></td>
            <td data-label="Status"><?= status_badge($p['status'], $p['payment_date']) ?></td>
            <td data-label="Reminders" class="small">
                <?= $p['confirmation_sent_at'] ? '<span title="Confirmation sent">✉️ Confirmed</span><br>' : '' ?>
                <?= $p['reminder_sent_at'] ? '<span title="' . e($p['reminder_sent_at']) . '">🔔 Reminded</span><br>' : '' ?>
                <?= $p['followup_sent_at'] ? '<span title="' . e($p['followup_sent_at']) . '">🔔 Follow-up</span><br>' : '' ?>
                <?= $p['thankyou_sent_at'] ? '<span title="' . e($p['thankyou_sent_at']) . '">💛 Thanked</span>' : '' ?>
            </td>
            <td class="actions">
                <form method="post" action="action.php">
                    <input type="hidden" name="token" value="<?= e($token) ?>">
                    <input type="hidden" name="id" value="<?= (int) $p['id'] ?>">
                    <input type="hidden" name="return" value="<?= e($returnTo) ?>">
                    <?php if ($p['status'] === 'pending'): ?>
                        <button class="btn btn-sm" name="action" value="mark_paid" data-confirm="Mark <?= e($p['full_name']) ?>'s gift as paid and send a thank-you?">✓ Mark paid</button>
                        <button class="btn btn-sm btn-ghost" name="action" value="send_reminder">Send reminder</button>
                    <?php elseif ($p['status'] === 'paid'): ?>
                        <button class="btn btn-sm btn-ghost" name="action" value="send_thankyou">Resend thank-you</button>
                    <?php else: ?>
                        <button class="btn btn-sm btn-ghost" name="action" value="restore">Restore</button>
                    <?php endif; ?>
                    <a class="btn btn-sm btn-wa" href="<?= e(pledge_whatsapp_link($p)) ?>" target="_blank" rel="noopener" title="Open WhatsApp with a ready-written message">WhatsApp</a>
                </form>
            </td>
        </tr>
    <?php endforeach; ?>
    </tbody>
</table>
</div>
<?php endif; ?>

<?php admin_footer(); ?>
