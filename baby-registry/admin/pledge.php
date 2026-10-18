<?php
/**
 * One pledge in detail: edit the date or note, see every message sent.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';
require_admin();

$id = (int) ($_GET['id'] ?? 0);
$p  = fetch_pledge($id);
if (!$p) {
    flash('error', 'That pledge no longer exists.');
    redirect('index.php');
}

$log = db()->prepare('SELECT * FROM notification_log WHERE pledge_id = ? ORDER BY id DESC');
$log->execute([$id]);
$log = $log->fetchAll();

$sum    = pledge_summary($p);
$token  = csrf_token();
$return = 'pledge.php?id=' . $id;

admin_header($p['full_name'], 'index.php');
?>
<p><a href="index.php">← All pledges</a></p>

<div class="detail">
    <section class="card">
        <div class="detail-head">
            <h1><?= e($p['full_name']) ?></h1>
            <?= status_badge($p['status'], $p['payment_date']) ?>
        </div>
        <dl class="dl">
            <dt>Reference</dt><dd><?= e($p['reference']) ?></dd>
            <dt>Gift</dt><dd><?= e($p['item_emoji'] . ' ' . $sum['label']) ?></dd>
            <dt>Amount</dt><dd><?= e($sum['amount']) ?></dd>
            <dt>Payment date</dt><dd><?= e(nice_date($p['payment_date'])) ?></dd>
            <dt>Phone</dt><dd><a href="tel:+<?= e($p['phone']) ?>"><?= e(display_phone($p['phone'])) ?></a></dd>
            <dt>Email</dt><dd><a href="mailto:<?= e($p['email']) ?>"><?= e($p['email']) ?></a></dd>
            <dt>Wants WhatsApp</dt><dd><?= $p['notify_via'] === 'both' ? 'Yes' : 'No (email only)' ?></dd>
            <dt>Pledged on</dt><dd><?= e(date('j M Y, H:i', strtotime($p['created_at']))) ?></dd>
            <?php if ($p['paid_at']): ?><dt>Paid on</dt><dd><?= e(date('j M Y, H:i', strtotime($p['paid_at']))) ?></dd><?php endif; ?>
        </dl>
        <?php if ($p['message'] !== ''): ?>
            <blockquote class="note"><?= nl2br(e($p['message'])) ?></blockquote>
        <?php endif; ?>

        <form method="post" action="action.php" class="actions-row">
            <input type="hidden" name="token" value="<?= e($token) ?>">
            <input type="hidden" name="id" value="<?= $id ?>">
            <input type="hidden" name="return" value="<?= e($return) ?>">
            <?php if ($p['status'] === 'pending'): ?>
                <button class="btn" name="action" value="mark_paid" data-confirm="Mark as paid and send a thank-you?">✓ Mark as paid</button>
                <button class="btn btn-ghost" name="action" value="send_reminder">Send reminder now</button>
                <button class="btn btn-ghost" name="action" value="cancel" data-confirm="Cancel this pledge? The gift becomes available again.">Cancel pledge</button>
            <?php elseif ($p['status'] === 'paid'): ?>
                <button class="btn btn-ghost" name="action" value="send_thankyou">Resend thank-you</button>
                <button class="btn btn-ghost" name="action" value="mark_unpaid" data-confirm="Mark as NOT paid?">Mark as not paid</button>
            <?php else: ?>
                <button class="btn btn-ghost" name="action" value="restore">Restore pledge</button>
            <?php endif; ?>
            <a class="btn btn-wa" href="<?= e(pledge_whatsapp_link($p)) ?>" target="_blank" rel="noopener">WhatsApp</a>
            <button class="btn btn-danger" name="action" value="delete" data-confirm="Delete this pledge permanently?">Delete</button>
        </form>
    </section>

    <section class="card">
        <h2>Edit</h2>
        <form method="post" action="action.php" class="form">
            <input type="hidden" name="token" value="<?= e($token) ?>">
            <input type="hidden" name="id" value="<?= $id ?>">
            <input type="hidden" name="return" value="<?= e($return) ?>">
            <label>Payment date
                <input type="date" name="payment_date" value="<?= e($p['payment_date']) ?>" required>
                <small class="muted">Changing the date schedules a fresh reminder for the new day.</small>
            </label>
            <label>Private note
                <textarea name="admin_note" rows="3" maxlength="500"><?= e($p['admin_note']) ?></textarea>
            </label>
            <button class="btn" name="action" value="update">Save changes</button>
        </form>

        <h2>Messages sent</h2>
        <?php if (!$log): ?>
            <p class="muted">No messages yet.</p>
        <?php else: ?>
            <ul class="log">
                <?php foreach ($log as $row): ?>
                <li class="<?= $row['success'] ? 'ok' : 'fail' ?>">
                    <strong><?= $row['success'] ? '✓' : '✗' ?> <?= e(ucfirst($row['type'])) ?></strong>
                    via <?= e($row['channel']) ?> to <?= e($row['recipient']) ?>
                    <span class="muted small">· <?= e(date('j M Y, H:i', strtotime($row['created_at']))) ?></span>
                    <?php if (!$row['success'] && $row['detail']): ?><div class="small muted"><?= e($row['detail']) ?></div><?php endif; ?>
                </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </section>
</div>

<?php admin_footer(); ?>
