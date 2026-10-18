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
    return (is_string($to) && preg_match('#^(index|pledge|items|item-edit|reveal)\.php(\?[A-Za-z0-9_=&%.\-]*)?$#', $to)) ? $to : $default;
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

function admin_header(string $title, string $active = ''): void
{
    $site = registry_config()['site'];
    $nav = ['index.php' => 'Pledges', 'items.php' => 'Gift items', 'reveal.php' => 'Guesses & wishes'];
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
<body>
<?php if (admin_logged_in()): ?>
<header class="topbar">
    <div class="wrap topbar-inner">
        <a class="brand" href="index.php">👶 <?= e($site['baby_name']) ?> <small>admin</small></a>
        <nav>
            <?php foreach ($nav as $href => $label): ?>
                <a href="<?= $href ?>"<?= $active === $href ? ' class="is-active"' : '' ?>><?= $label ?></a>
            <?php endforeach; ?>
            <a href="../" target="_blank" rel="noopener">View site ↗</a>
            <a href="logout.php">Log out</a>
        </nav>
    </div>
</header>
<?php endif; ?>
<main class="wrap">
<?php
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
    ?>
</main>
<script src="<?= e(asset('assets/js/admin.js', '../')) ?>" defer></script>
</body>
</html>
<?php
}
