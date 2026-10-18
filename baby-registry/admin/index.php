<?php
/**
 * Admin overview: the numbers that matter, what needs attention today,
 * and recent activity.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';
require_admin();

$pdo = db();

// Gifts
$items      = fetch_items();
$fixed      = array_values(array_filter($items, static fn($i) => !$i['is_open_amount']));
$takenCount = count(array_filter($fixed, static fn($i) => $i['remaining'] === 0));
$byCategory = [];
foreach ($fixed as $item) {
    $byCategory[$item['category']] ??= ['total' => 0, 'taken' => 0];
    $byCategory[$item['category']]['total']++;
    $byCategory[$item['category']]['taken'] += $item['remaining'] === 0 ? 1 : 0;
}

// Pledges
$p = $pdo->query(
    "SELECT
        SUM(status IN ('pending', 'paid'))                       AS active,
        SUM(status = 'paid')                                     AS paid,
        SUM(status = 'pending')                                  AS pending,
        SUM(status = 'pending' AND payment_date <= CURDATE())    AS due,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid_value
     FROM pledges"
)->fetch();

$attention = $pdo->query(PLEDGE_SELECT_SQL . " WHERE p.status = 'pending' AND p.payment_date <= CURDATE()
                                               ORDER BY p.payment_date, p.id LIMIT 6")->fetchAll();
$upcoming  = $pdo->query(PLEDGE_SELECT_SQL . " WHERE p.status = 'pending' AND p.payment_date > CURDATE()
                                               ORDER BY p.payment_date, p.id LIMIT 5")->fetchAll();

$activity = $pdo->query(
    "(SELECT 'pledge' AS kind, p.id, p.full_name AS who, p.created_at,
             (SELECT COUNT(*) FROM pledge_items pi WHERE pi.pledge_id = p.id) AS n, NULL AS guess
        FROM pledges p)
     UNION ALL
     (SELECT 'guess' AS kind, g.id, g.name AS who, g.created_at, 0 AS n, g.guess FROM gender_guesses g)
     ORDER BY created_at DESC LIMIT 8"
)->fetchAll();

// Guesses, reveal and email health
$tally    = guess_tally();
$gender   = get_setting('baby_gender');
$revealed = get_setting('revealed') === '1' && $gender !== '';
$failed   = (int) $pdo->query("SELECT COUNT(*) FROM notification_log WHERE success = 0 AND created_at > (NOW() - INTERVAL 7 DAY)")->fetchColumn();
$sentOk   = (int) $pdo->query("SELECT COUNT(*) FROM notification_log WHERE success = 1 AND created_at > (NOW() - INTERVAL 7 DAY)")->fetchColumn();

$pct = static fn(int $a, int $b): int => $b ? (int) round($a / $b * 100) : 0;
$token = csrf_token();

admin_header('Overview', 'index.php');
?>
<?php if ($failed): ?>
<div class="flash flash-error">
    <span><?= $failed ?> email/WhatsApp message(s) could not be sent in the last 7 days.</span>
    <a class="btn btn-sm" href="settings.php">Check email settings</a>
</div>
<?php endif; ?>

<section class="kpis">
    <a class="kpi" href="items.php">
        <span class="kpi-label">Gifts picked</span>
        <strong class="kpi-value"><?= $takenCount ?><small> / <?= count($fixed) ?></small></strong>
        <span class="kpi-bar"><span style="width: <?= $pct($takenCount, count($fixed)) ?>%"></span></span>
    </a>
    <a class="kpi" href="pledges.php?filter=all">
        <span class="kpi-label">Guests who pledged</span>
        <strong class="kpi-value"><?= (int) $p['active'] ?></strong>
        <span class="kpi-sub"><?= (int) $p['pending'] ?> waiting · <?= (int) $p['paid'] ?> paid</span>
    </a>
    <a class="kpi" href="pledges.php?filter=paid">
        <span class="kpi-label">Received (est. value)</span>
        <strong class="kpi-value"><?= e(money((float) $p['paid_value'])) ?></strong>
        <span class="kpi-sub">from <?= (int) $p['paid'] ?> paid pledge(s)</span>
    </a>
    <a class="kpi<?= (int) $p['due'] ? ' kpi-alert' : '' ?>" href="pledges.php">
        <span class="kpi-label">Due or overdue</span>
        <strong class="kpi-value"><?= (int) $p['due'] ?></strong>
        <span class="kpi-sub"><?= (int) $p['due'] ? 'need a check today' : 'all caught up 🎉' ?></span>
    </a>
    <a class="kpi" href="reveal.php">
        <span class="kpi-label">Guesses</span>
        <strong class="kpi-value"><?= $tally['total'] ?></strong>
        <span class="kpi-split">
            <span class="split-boy" style="width: <?= $pct($tally['boy'], $tally['total']) ?>%"></span>
            <span class="split-girl" style="width: <?= $pct($tally['girl'], $tally['total']) ?>%"></span>
        </span>
        <span class="kpi-sub">💙 <?= $pct($tally['boy'], $tally['total']) ?>% · 💗 <?= $pct($tally['girl'], $tally['total']) ?>%</span>
    </a>
</section>

<div class="grid-2">
    <section class="panel">
        <div class="panel-head">
            <h2>Needs your attention</h2>
            <a href="pledges.php">See all →</a>
        </div>
        <?php if (!$attention): ?>
            <p class="empty-mini">Nothing is due right now. 🎉</p>
        <?php else: ?>
        <ul class="list">
            <?php foreach ($attention as $row): ?>
            <li>
                <div class="list-main">
                    <a class="strong" href="pledge.php?id=<?= (int) $row['id'] ?>"><?= e($row['full_name']) ?></a>
                    <span class="muted small"><?= e(implode(', ', pledge_items_list($row))) ?></span>
                </div>
                <?= status_badge($row['status'], $row['payment_date']) ?>
                <form method="post" action="action.php" class="list-actions">
                    <input type="hidden" name="token" value="<?= e($token) ?>">
                    <input type="hidden" name="id" value="<?= (int) $row['id'] ?>">
                    <input type="hidden" name="return" value="index.php">
                    <button class="btn btn-sm" name="action" value="mark_paid" data-confirm="Mark <?= e($row['full_name']) ?>'s gifts as paid and send a thank-you?">✓ Paid</button>
                    <a class="btn btn-sm btn-wa" href="<?= e(pledge_whatsapp_link($row)) ?>" target="_blank" rel="noopener">WhatsApp</a>
                </form>
            </li>
            <?php endforeach; ?>
        </ul>
        <?php endif; ?>
    </section>

    <section class="panel">
        <div class="panel-head">
            <h2>Coming up</h2>
            <a href="pledges.php?filter=pending">All pending →</a>
        </div>
        <?php if (!$upcoming): ?>
            <p class="empty-mini">No upcoming payment days yet.</p>
        <?php else: ?>
        <ul class="list">
            <?php foreach ($upcoming as $row): ?>
            <li>
                <span class="date-chip"><strong><?= e(date('j', strtotime($row['payment_date']))) ?></strong><?= e(date('M', strtotime($row['payment_date']))) ?></span>
                <div class="list-main">
                    <a class="strong" href="pledge.php?id=<?= (int) $row['id'] ?>"><?= e($row['full_name']) ?></a>
                    <span class="muted small"><?= e(implode(', ', pledge_items_list($row))) ?></span>
                </div>
            </li>
            <?php endforeach; ?>
        </ul>
        <?php endif; ?>
    </section>

    <section class="panel">
        <div class="panel-head">
            <h2>Gifts by category</h2>
            <a href="items.php">Manage →</a>
        </div>
        <ul class="cat-progress">
            <?php foreach ($byCategory as $cat => $c): ?>
            <li>
                <span class="cat-name"><?= e($cat) ?></span>
                <span class="kpi-bar"><span style="width: <?= $pct($c['taken'], $c['total']) ?>%"></span></span>
                <span class="cat-count"><?= $c['taken'] ?>/<?= $c['total'] ?></span>
            </li>
            <?php endforeach; ?>
        </ul>
    </section>

    <section class="panel">
        <div class="panel-head">
            <h2>Recent activity</h2>
        </div>
        <?php if (!$activity): ?>
            <p class="empty-mini">No guesses or pledges yet. Share the link! 🎈</p>
        <?php else: ?>
        <ul class="list feed">
            <?php foreach ($activity as $a): ?>
            <li>
                <span class="feed-dot <?= $a['kind'] === 'guess' ? ($a['guess'] === 'boy' ? 'is-boy' : 'is-girl') : 'is-gift' ?>" aria-hidden="true">
                    <?= $a['kind'] === 'guess' ? ($a['guess'] === 'boy' ? '💙' : '💗') : '🎁' ?>
                </span>
                <div class="list-main">
                    <span><strong><?= e($a['who'] !== '' ? $a['who'] : 'Someone') ?></strong>
                        <?= $a['kind'] === 'guess'
                            ? 'guessed ' . e($a['guess'])
                            : 'pledged ' . (int) $a['n'] . ' gift' . ((int) $a['n'] === 1 ? '' : 's') ?></span>
                    <span class="muted small"><?= e(date('j M, H:i', strtotime($a['created_at']))) ?></span>
                </div>
            </li>
            <?php endforeach; ?>
        </ul>
        <?php endif; ?>
    </section>
</div>

<div class="grid-2">
    <section class="panel panel-row">
        <div>
            <h2>Gender reveal</h2>
            <p class="muted"><?= $revealed ? "Revealed – it's a " . e($gender) . '!' : ($gender ? 'Set, still a secret.' : 'Not set yet.') ?></p>
        </div>
        <a class="btn btn-ghost" href="reveal.php">Open</a>
    </section>
    <section class="panel panel-row">
        <div>
            <h2>Messages</h2>
            <p class="muted"><?= $sentOk ?> sent, <?= $failed ?> failed in the last 7 days.</p>
        </div>
        <a class="btn btn-ghost" href="settings.php">Email & settings</a>
    </section>
</div>

<?php admin_footer(); ?>
