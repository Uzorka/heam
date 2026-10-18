<?php
/**
 * Email & settings: check the email / WhatsApp setup, send test messages,
 * and see every message the site has tried to send.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';
require_admin();

$config = registry_config();
$mail   = $config['mail'];
$wa     = $config['whatsapp'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_post_csrf();

    switch ($_POST['action'] ?? '') {
        case 'test_email':
            $to = trim((string) ($_POST['to'] ?? ''));
            $subject = 'Test email from your baby registry';
            $text = "Hello!\n\nThis is a test email from your baby registry. If you can read this, emails are working. 🎉";
            [$ok, $detail] = send_email($to, '', $subject, email_html($subject, $text, false, registry_url() . '/'), $text);
            log_notification(null, 'email', 'test', $to, $ok, $detail);
            $ok
                ? flash('success', "Test email sent to {$to}. Check the inbox (and the spam folder).")
                : flash('error', "The email could not be sent: {$detail}");
            break;

        case 'test_whatsapp':
            $phone = normalize_phone((string) ($_POST['phone'] ?? ''));
            [$ok, $detail] = whatsapp_test($phone);
            log_notification(null, 'whatsapp', 'test', display_phone($phone), $ok, $detail);
            $ok
                ? flash('success', 'Test WhatsApp sent to ' . display_phone($phone) . '. Check the phone.')
                : flash('error', "The WhatsApp message could not be sent: {$detail}");
            break;
    }
    redirect('settings.php');
}

$log = db()->query(
    'SELECT l.*, p.full_name FROM notification_log l LEFT JOIN pledges p ON p.id = l.pledge_id ORDER BY l.id DESC LIMIT 30'
)->fetchAll();

// Things that commonly stop email from working.
$problems = [];
if (($mail['transport'] ?? '') === 'smtp') {
    if (!filter_var($mail['from_email'], FILTER_VALIDATE_EMAIL)) {
        $problems[] = '"from_email" is not an email address. It should be your mailbox, e.g. registry@yourdomain.com.';
    }
    if (strcasecmp($mail['from_email'], $mail['smtp']['username']) !== 0) {
        $problems[] = '"from_email" and the SMTP "username" should be the same mailbox.';
    }
    if ($mail['smtp']['password'] === '') {
        $problems[] = 'The SMTP mailbox password is empty.';
    }
}
if (($mail['reply_to'] ?? '') !== '' && !filter_var($mail['reply_to'], FILTER_VALIDATE_EMAIL)) {
    $problems[] = '"reply_to" is not an email address. Use your personal email, or leave it empty.';
}
if ($config['admin']['notify_email'] !== '' && !filter_var($config['admin']['notify_email'], FILTER_VALIDATE_EMAIL)) {
    $problems[] = '"notify_email" is not a valid email address.';
}

$cronPath = REGISTRY_ROOT . '/cron/send-reminders.php';
$token = csrf_token();

admin_header('Email & settings', 'settings.php');
?>
<div class="grid-2">
    <section class="panel">
        <div class="panel-head"><h2>Email</h2></div>
        <dl class="dl">
            <dt>Sending method</dt><dd><?= ($mail['transport'] ?? '') === 'smtp' ? 'SMTP (Hostinger mailbox)' : 'PHP mail()' ?></dd>
            <dt>Sent from</dt><dd><?= e($mail['from_name']) ?> &lt;<?= e($mail['from_email']) ?>&gt;</dd>
            <?php if (($mail['transport'] ?? '') === 'smtp'): ?>
            <dt>SMTP server</dt><dd><?= e($mail['smtp']['host'] . ':' . $mail['smtp']['port'] . ' (' . $mail['smtp']['encryption'] . ')') ?></dd>
            <dt>SMTP username</dt><dd><?= e($mail['smtp']['username']) ?></dd>
            <dt>SMTP password</dt><dd><?= $mail['smtp']['password'] !== '' ? 'Set' : '<span class="text-danger">Missing</span>' ?></dd>
            <?php endif; ?>
            <dt>Replies go to</dt><dd><?= e($mail['reply_to'] ?: $mail['from_email']) ?></dd>
            <dt>New-pledge alerts to</dt><dd><?= e($config['admin']['notify_email'] ?: 'Off') ?></dd>
        </dl>

        <?php if ($problems): ?>
            <div class="flash flash-error"><span><strong>Fix in includes/config.php:</strong><br><?= implode('<br>', array_map('e', $problems)) ?></span></div>
        <?php endif; ?>

        <form method="post" class="form inline-form">
            <input type="hidden" name="token" value="<?= e($token) ?>">
            <label>Send a test email to
                <input type="email" name="to" required value="<?= e($config['admin']['notify_email'] ?: $mail['reply_to']) ?>" placeholder="you@gmail.com">
            </label>
            <button class="btn" name="action" value="test_email">Send test email</button>
        </form>
        <p class="muted small">If it fails, the exact reason appears at the top of this page and in the log below.</p>
    </section>

    <section class="panel">
        <div class="panel-head"><h2>WhatsApp</h2></div>
        <dl class="dl">
            <dt>Automatic WhatsApp</dt>
            <dd><?= match ($wa['provider'] ?? 'none') {
                'meta'   => 'On – WhatsApp Cloud API (Meta)',
                'twilio' => 'On – Twilio',
                default  => 'Off – you send them yourself with the WhatsApp buttons',
            } ?></dd>
            <dt>Country code for 0… numbers</dt><dd>+<?= e($wa['default_country_code']) ?></dd>
        </dl>
        <form method="post" class="form inline-form">
            <input type="hidden" name="token" value="<?= e($token) ?>">
            <label>Send a test WhatsApp to
                <input type="tel" name="phone" required placeholder="0803 123 4567">
            </label>
            <button class="btn" name="action" value="test_whatsapp"<?= in_array($wa['provider'] ?? 'none', ['meta', 'twilio'], true) ? '' : ' disabled' ?>>Send test WhatsApp</button>
        </form>
        <p class="muted small">Set up automatic WhatsApp in includes/config.php (see README.md, section 8).</p>

        <div class="panel-head spaced-top"><h2>Daily reminders</h2></div>
        <p class="muted small">Hostinger → Advanced → Cron Jobs → type <strong>PHP</strong>, once a day, with this path:</p>
        <code class="code-line"><?= e($cronPath) ?></code>
    </section>
</div>

<section class="panel">
    <div class="panel-head"><h2>Message log</h2><span class="muted small">Last 30 emails and WhatsApp messages</span></div>
    <?php if (!$log): ?>
        <p class="empty-mini">Nothing sent yet.</p>
    <?php else: ?>
    <div class="table-wrap flat">
    <table class="table">
        <thead><tr><th>When</th><th>Type</th><th>To</th><th>Result</th></tr></thead>
        <tbody>
        <?php foreach ($log as $row): ?>
            <tr>
                <td data-label="When" class="nowrap small"><?= e(date('j M, H:i', strtotime($row['created_at']))) ?></td>
                <td data-label="Type"><?= e(ucfirst($row['type'])) ?> <span class="muted small">by <?= e($row['channel']) ?></span></td>
                <td data-label="To"><?= e($row['recipient']) ?><?php if ($row['full_name']): ?> <span class="muted small">(<?= e($row['full_name']) ?>)</span><?php endif; ?></td>
                <td data-label="Result">
                    <?= $row['success'] ? '<span class="pill pill-paid">Sent</span>' : '<span class="pill pill-overdue">Failed</span>' ?>
                    <?php if (!$row['success'] && $row['detail']): ?><div class="small text-danger"><?= e($row['detail']) ?></div><?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    </div>
    <?php endif; ?>
</section>

<?php admin_footer(); ?>
