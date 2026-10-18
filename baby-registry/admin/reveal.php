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
            flash('success', 'Revealed! 🎉 Visitors who pop the balloon now see the answer.');
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
$token = csrf_token();
$pct = static fn(int $n): int => $tally['total'] ? (int) round($n / $tally['total'] * 100) : 0;

admin_header('Guesses & wishes', 'reveal.php');
?>
<h1>Gender reveal &amp; wishes</h1>

<div class="detail">
    <section class="card">
        <h2>The big reveal</h2>
        <p>Status:
            <?= $revealed
                ? '<span class="pill pill-paid">Revealed – it\'s a ' . e($gender) . '!</span>'
                : '<span class="pill pill-pending">Secret</span>' ?>
        </p>
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

<h2 class="spaced">Guesses</h2>
<?php if (!$guesses): ?>
    <p class="empty">No guesses yet. Share the link! 🎈</p>
<?php else: ?>
<div class="table-wrap">
<table class="table">
    <thead><tr><th>Name</th><th>Guess</th><th>Wish</th><th>When</th><th class="right">Actions</th></tr></thead>
    <tbody>
    <?php foreach ($guesses as $g): ?>
        <tr class="<?= $g['is_hidden'] ? 'is-muted' : '' ?>">
            <td data-label="Name"><?= e($g['name'] !== '' ? $g['name'] : 'Anonymous') ?></td>
            <td data-label="Guess" class="nowrap">
                <?= $g['guess'] === 'boy' ? '💙 Boy' : '💗 Girl' ?>
                <?php if ($revealed): ?><?= $g['guess'] === $gender ? ' ✓' : '' ?><?php endif; ?>
            </td>
            <td data-label="Wish"><?= $g['message'] !== '' ? e($g['message']) : '<span class="muted">–</span>' ?></td>
            <td data-label="When" class="nowrap small"><?= e(date('j M, H:i', strtotime($g['created_at']))) ?></td>
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
