<?php
/**
 * Admin helpers: login check, flash messages and the shared page layout.
 */

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

start_secure_session();
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

function admin_logged_in(): bool
{
    return !empty($_SESSION['admin_user'])
        && ($_SESSION['admin_hash'] ?? '') === substr(hash('sha256', registry_config()['admin']['password_hash']), 0, 16);
}

function require_admin(): void
{
    if (!admin_logged_in()) {
        header('Location: login.php');
        exit;
    }
}

/** Rejects POSTs without a valid CSRF token. */
function require_post_csrf(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !csrf_valid($_POST['token'] ?? null)) {
        http_response_code(400);
        exit('Invalid request. Please go back, refresh the page and try again.');
    }
}

/**
 * @param string $type 'success' | 'error' | 'info'
 * @param array  $links Extra buttons: [['label' => ..., 'href' => ...]]
 */
function flash(string $type, string $message, array $links = []): void
{
    $_SESSION['flash'][] = ['type' => $type, 'message' => $message, 'links' => $links];
}

function redirect(string $to): never
{
    header('Location: ' . $to);
    exit;
}

/** Only allow redirecting back to admin pages in this folder. */
function safe_return(?string $to, string $default = 'index.php'): string
{
    return (is_string($to) && preg_match('#^(index|pledges|pledge|items|item-edit|reveal|settings)\.php(\?[A-Za-z0-9_=&%.\-]*)?$#', $to)) ? $to : $default;
}

function status_badge(string $status, string $paymentDate = ''): string
{
    if ($status === 'pending' && $paymentDate !== '') {
        $today = date('Y-m-d');
        if ($paymentDate < $today) {
            return '<span class="pill pill-overdue">Overdue</span>';
        }
        if ($paymentDate === $today) {
            return '<span class="pill pill-due">Due today</span>';
        }
    }
    $labels = ['pending' => 'Pending', 'paid' => 'Paid', 'cancelled' => 'Cancelled'];
    return '<span class="pill pill-' . e($status) . '">' . e($labels[$status] ?? $status) . '</span>';
}

/** Click-to-chat WhatsApp link with the right message for the pledge's state. */
function pledge_whatsapp_link(array $pledge, ?string $type = null): string
{
    $type ??= $pledge['status'] === 'paid' ? 'thankyou' : ($pledge['payment_date'] <= date('Y-m-d') ? 'reminder' : 'confirmation');
    return whatsapp_click_link($pledge['phone'], pledge_message($pledge, $type)['text']);
}

/** Small line icons for the sidebar (inline SVG, no icon library needed). */
function admin_icon(string $name): string
{
    $paths = [
        'overview' => '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
        'pledges'  => '<path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8"/><rect x="2" y="7" width="20" height="5" rx="1"/><path d="M12 21V7"/><path d="M12 7c-2-4-6-4-6-1.5S9 7 12 7c3 0 6-1 6-1.5S14 3 12 7z"/>',
        'items'    => '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
        'reveal'   => '<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/>',
        'settings' => '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
        'site'     => '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
        'logout'   => '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
        'menu'     => '<path d="M3 6h18M3 12h18M3 18h18"/>',
    ];
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
         . ($paths[$name] ?? '') . '</svg>';
}

function admin_header(string $title, string $active = ''): void
{
    $site = registry_config()['site'];
    $due = 0;
    if (admin_logged_in()) {
        try {
            $due = (int) db()->query("SELECT COUNT(*) FROM pledges WHERE status = 'pending' AND payment_date <= CURDATE()")->fetchColumn();
        } catch (Throwable $e) {
            $due = 0;
        }
    }
    $nav = [
        'index.php'    => ['Overview', 'overview', 0],
        'pledges.php'  => ['Pledges', 'pledges', $due],
        'items.php'    => ['Gift items', 'items', 0],
        'reveal.php'   => ['Guesses & wishes', 'reveal', 0],
        'settings.php' => ['Email & settings', 'settings', 0],
    ];
    ?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title><?= e($title) ?> · Registry admin</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>👶</text></svg>">
    <link rel="stylesheet" href="<?= e(asset('assets/css/admin.css', '../')) ?>">
</head>
<body class="<?= admin_logged_in() ? 'has-shell' : 'is-login' ?>">
<?php if (admin_logged_in()): ?>
<div class="shell">
    <aside class="sidebar" id="sidebar">
        <a class="side-brand" href="index.php">
            <span class="side-logo" aria-hidden="true">👶</span>
            <span><strong><?= e($site['baby_name']) ?></strong><small>Registry admin</small></span>
        </a>
        <nav class="side-nav" aria-label="Admin">
            <?php foreach ($nav as $href => [$label, $icon, $badge]): ?>
                <a href="<?= $href ?>"<?= $active === $href ? ' class="is-active" aria-current="page"' : '' ?>>
                    <?= admin_icon($icon) ?><span><?= e($label) ?></span>
                    <?php if ($badge): ?><em class="side-badge" title="Due or overdue"><?= $badge ?></em><?php endif; ?>
                </a>
            <?php endforeach; ?>
        </nav>
        <div class="side-foot">
            <a href="../" target="_blank" rel="noopener"><?= admin_icon('site') ?><span>View the site</span></a>
            <a href="logout.php"><?= admin_icon('logout') ?><span>Log out</span></a>
        </div>
    </aside>
    <div class="side-scrim" id="side-scrim" hidden></div>

    <div class="main">
        <header class="topbar">
            <button type="button" class="menu-btn" id="menu-btn" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false"><?= admin_icon('menu') ?></button>
            <h1 class="top-title"><?= e($title) ?></h1>
            <span class="top-date"><?= e(date('l, j F Y')) ?></span>
        </header>
        <main class="content">
<?php else: ?>
<main class="content content-login">
<?php endif;
    foreach ($_SESSION['flash'] ?? [] as $f): ?>
    <div class="flash flash-<?= e($f['type']) ?>">
        <span><?= e($f['message']) ?></span>
        <?php foreach ($f['links'] as $link): ?>
            <a class="btn btn-sm btn-wa" href="<?= e($link['href']) ?>" target="_blank" rel="noopener"><?= e($link['label']) ?></a>
        <?php endforeach; ?>
    </div>
<?php endforeach;
    unset($_SESSION['flash']);
}

function admin_footer(): void
{
    if (admin_logged_in()): ?>
        </main>
    </div>
</div>
<?php else: ?>
</main>
<?php endif; ?>
<script src="<?= e(asset('assets/js/admin.js', '../')) ?>" defer></script>
</body>
</html>
<?php
}
