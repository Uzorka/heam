<?php
/**
 * Gender reveal settings, guess results and the wishes wall.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';
require_admin();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_post_csrf();
    $id = (int) ($_POST['id'] ?? 0);

    switch ($_POST['action'] ?? '') {
        case 'save_gender':
            $gender = (string) ($_POST['baby_gender'] ?? '');
            set_setting('baby_gender', in_array($gender, ['boy', 'girl'], true) ? $gender : '');
            if (!in_array($gender, ['boy', 'girl'], true)) {
                set_setting('revealed', '0');
            }
            flash('success', 'Saved. Guests still cannot see it until you press "Reveal now".');
            break;

        case 'reveal':
            if (!in_array(get_setting('baby_gender'), ['boy', 'girl'], true)) {
                flash('error', 'Choose boy or girl first.');
                break;
            }
            set_setting('revealed', '1');
            @set_time_limit(300);
            $sent = send_reveal_notifications();
            flash('success', 'Revealed! 🎉 Visitors who pop the balloon now see the answer. '
                . "The news was sent to {$sent['sent']} guest(s)"
                . ($sent['failed'] ? ", {$sent['failed']} could not be reached (see below)" : '') . '.');
            break;

        case 'resend_reveal':
            $sent = send_reveal_notifications();
            flash('success', "Sent to {$sent['sent']} more guest(s)" . ($sent['failed'] ? ", {$sent['failed']} failed" : '') . '.');
            break;

        case 'unreveal':
            set_setting('revealed', '0');
            flash('info', 'The gender is a secret again.');
            break;

        case 'toggle_guess':
            db()->prepare('UPDATE gender_guesses SET is_hidden = 1 - is_hidden WHERE id = ?')->execute([$id]);
            flash('success', 'Wish updated.');
            break;

        case 'delete_guess':
            db()->prepare('DELETE FROM gender_guesses WHERE id = ?')->execute([$id]);
            flash('info', 'Guess deleted.');
            break;

        case 'toggle_pledge_wish':
            db()->prepare('UPDATE pledges SET share_message = 1 - share_message WHERE id = ?')->execute([$id]);
            flash('success', 'Wish updated.');
            break;
    }
    redirect('reveal.php');
}

$gender   = get_setting('baby_gender');
$revealed = get_setting('revealed') === '1' && $gender !== '';
$tally    = guess_tally();
$guesses  = db()->query('SELECT * FROM gender_guesses ORDER BY id DESC')->fetchAll();
$pledgeWishes = db()->query(
    "SELECT id, full_name, message, share_message, created_at FROM pledges
     WHERE message <> '' AND status <> 'cancelled' ORDER BY id DESC"
)->fetchAll();
$names = db()->query(
    "SELECT baby_name, COUNT(*) AS n FROM gender_guesses WHERE baby_name <> '' GROUP BY baby_name ORDER BY n DESC, baby_name LIMIT 30"
)->fetchAll();
$waitingNews = (int) db()->query(
    "SELECT COUNT(*) FROM gender_guesses WHERE notified_at IS NULL AND (email <> '' OR phone <> '')"
)->fetchColumn();
// Guests who only left a WhatsApp number, when WhatsApp is not sent automatically.
$manualWa = ($revealed && !whatsapp_enabled())
    ? db()->query("SELECT * FROM gender_guesses WHERE phone <> '' AND email = '' ORDER BY id")->fetchAll()
    : [];
$token = csrf_token();
$pct = static fn(int $n): int => $tally['total'] ? (int) round($n / $tally['total'] * 100) : 0;

admin_header('Guesses & wishes', 'reveal.php');
?>

<div class="detail">
    <section class="card">
        <h2>The big reveal</h2>
        <p>Status:
            <?= $revealed
                ? '<span class="pill pill-paid">Revealed – it\'s a ' . e($gender) . '!</span>'
                : '<span class="pill pill-pending">Secret</span>' ?>
        </p>
        <p class="muted small"><?= $waitingNews ?> guest(s) left contact details and are waiting to hear the news.
            When you press "Reveal now" they are all sent an email (and WhatsApp, if set up) with the answer.</p>
        <p class="muted small">While it is a secret, the gender is never sent to visitors' browsers, so nobody can peek.
            Guests guess, pop the balloon and see the vote count. Once you reveal, popping the balloon shows the answer
            and tells each guest if they were right.</p>

        <form method="post" class="form">
            <input type="hidden" name="token" value="<?= e($token) ?>">
            <label>The baby is a…
                <select name="baby_gender" class="select">
                    <option value="">Not set yet</option>
                    <option value="girl"<?= $gender === 'girl' ? ' selected' : '' ?>>Girl 💗</option>
                    <option value="boy"<?= $gender === 'boy' ? ' selected' : '' ?>>Boy 💙</option>
                </select>
            </label>
            <div class="actions-row">
                <button class="btn btn-ghost" name="action" value="save_gender">Save</button>
                <?php if ($revealed): ?>
                    <button class="btn btn-ghost" name="action" value="unreveal" data-confirm="Hide the gender again?">Make it a secret again</button>
                    <?php if ($waitingNews): ?><button class="btn btn-ghost" name="action" value="resend_reveal">Send the news to <?= $waitingNews ?> more</button><?php endif; ?>
                <?php else: ?>
                    <button class="btn" name="action" value="reveal" data-confirm="Reveal the gender to everyone now?">🎉 Reveal now</button>
                <?php endif; ?>
            </div>
        </form>
    </section>

    <section class="card">
        <h2>What guests think</h2>
        <div class="tally-admin">
            <div><span>💙 Boy</span><div class="bar"><span class="bar-boy" style="width: <?= $pct($tally['boy']) ?>%"></span></div><strong><?= $tally['boy'] ?> (<?= $pct($tally['boy']) ?>%)</strong></div>
            <div><span>💗 Girl</span><div class="bar"><span class="bar-girl" style="width: <?= $pct($tally['girl']) ?>%"></span></div><strong><?= $tally['girl'] ?> (<?= $pct($tally['girl']) ?>%)</strong></div>
        </div>
        <p class="muted"><?= $tally['total'] ?> guesses in total<?php if ($revealed && $tally['total']): ?>
            · <?= $tally[$gender] ?> guessed right<?php endif; ?></p>
    </section>
</div>

<?php if ($manualWa): ?>
<h2 class="spaced">Tell these guests on WhatsApp</h2>
<p class="muted">They only left a WhatsApp number. Tap each button to open WhatsApp with the news already written.</p>
<div class="actions-row">
    <?php foreach ($manualWa as $g): ?>
        <a class="btn btn-sm btn-wa" target="_blank" rel="noopener"
           href="<?= e(whatsapp_click_link($g['phone'], reveal_message($g, $gender)['text'])) ?>"><?= e(($g['name'] ?: 'Guest') . ' · ' . display_phone($g['phone'])) ?></a>
    <?php endforeach; ?>
</div>
<?php endif; ?>

<?php if ($names): ?>
<h2 class="spaced">Suggested baby names</h2>
<div class="name-cloud">
    <?php foreach ($names as $n): ?>
        <span class="name-chip"><?= e($n['baby_name']) ?><?php if ($n['n'] > 1): ?> <small>×<?= (int) $n['n'] ?></small><?php endif; ?></span>
    <?php endforeach; ?>
</div>
<?php endif; ?>

<h2 class="spaced">Guesses</h2>
<?php if (!$guesses): ?>
    <p class="empty">No guesses yet. Share the link! 🎈</p>
<?php else: ?>
<div class="table-wrap">
<table class="table">
    <thead><tr><th>Name</th><th>Guess</th><th>Suggested name</th><th>Wish</th><th>Contact</th><th class="right">Actions</th></tr></thead>
    <tbody>
    <?php foreach ($guesses as $g): ?>
        <tr class="<?= $g['is_hidden'] ? 'is-muted' : '' ?>">
            <td data-label="Name"><?= e($g['name'] !== '' ? $g['name'] : 'Anonymous') ?></td>
            <td data-label="Guess" class="nowrap">
                <?= $g['guess'] === 'boy' ? '💙 Boy' : '💗 Girl' ?>
                <?php if ($revealed): ?><?= $g['guess'] === $gender ? ' ✓' : '' ?><?php endif; ?>
            </td>
            <td data-label="Suggested name"><?= $g['baby_name'] !== '' ? e($g['baby_name']) : '<span class="muted">–</span>' ?></td>
            <td data-label="Wish"><?= $g['message'] !== '' ? e($g['message']) : '<span class="muted">–</span>' ?></td>
            <td data-label="Contact" class="small">
                <?= e(implode(' · ', array_filter([$g['email'], display_phone($g['phone'])]))) ?: '<span class="muted">–</span>' ?>
                <?php if ($g['notified_at'] && ($g['email'] !== '' || whatsapp_enabled())): ?><div class="muted">✓ told about the reveal</div><?php endif; ?>
            </td>
            <td class="actions">
                <form method="post">
                    <input type="hidden" name="token" value="<?= e($token) ?>">
                    <input type="hidden" name="id" value="<?= (int) $g['id'] ?>">
                    <?php if ($g['message'] !== ''): ?>
                        <button class="btn btn-sm btn-ghost" name="action" value="toggle_guess"><?= $g['is_hidden'] ? 'Show wish' : 'Hide wish' ?></button>
                    <?php endif; ?>
                    <button class="btn btn-sm btn-danger" name="action" value="delete_guess" data-confirm="Delete this guess?">Delete</button>
                </form>
            </td>
        </tr>
    <?php endforeach; ?>
    </tbody>
</table>
</div>
<?php endif; ?>

<h2 class="spaced">Notes left with gifts</h2>
<?php if (!$pledgeWishes): ?>
    <p class="empty">No notes yet.</p>
<?php else: ?>
<div class="table-wrap">
<table class="table">
    <thead><tr><th>From</th><th>Note</th><th>On the wall</th><th class="right">Actions</th></tr></thead>
    <tbody>
    <?php foreach ($pledgeWishes as $w): ?>
        <tr>
            <td data-label="From"><a href="pledge.php?id=<?= (int) $w['id'] ?>"><?= e($w['full_name']) ?></a></td>
            <td data-label="Note"><?= e($w['message']) ?></td>
            <td data-label="On the wall"><?= $w['share_message'] ? 'Yes' : 'No (private)' ?></td>
            <td class="actions">
                <form method="post">
                    <input type="hidden" name="token" value="<?= e($token) ?>">
                    <input type="hidden" name="id" value="<?= (int) $w['id'] ?>">
                    <button class="btn btn-sm btn-ghost" name="action" value="toggle_pledge_wish"><?= $w['share_message'] ? 'Hide from wall' : 'Show on wall' ?></button>
                </form>
            </td>
        </tr>
    <?php endforeach; ?>
    </tbody>
</table>
</div>
<?php endif; ?>

<?php admin_footer(); ?>
