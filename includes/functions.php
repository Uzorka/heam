<?php
/**
 * Small shared helpers. No framework, just functions.
 */

declare(strict_types=1);

/** Escape a value for safe output in HTML text or attributes. */
function e($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Inline SVG icon from the sprite in includes/icons.php. Decorative by default. */
function icon(string $name, string $class = 'icon'): string
{
    return '<svg class="' . e($class) . '" aria-hidden="true" focusable="false">'
         . '<use href="#icon-' . e($name) . '"></use></svg>';
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443')
        || (strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

/** The current host name, restricted to safe characters. */
function current_host(): string
{
    $host = strtolower($_SERVER['HTTP_HOST'] ?? 'localhost');
    return preg_match('/^[a-z0-9.\-]+(:\d+)?$/', $host) ? $host : 'localhost';
}

/** Absolute site URL without a trailing slash. */
function site_url(array $config): string
{
    if (!empty($config['site']['url'])) {
        return rtrim($config['site']['url'], '/');
    }
    return (is_https() ? 'https://' : 'http://') . current_host();
}

/** Asset URL with a file-modified version string, so browsers re-download after edits. */
function asset(string $path): string
{
    $path = ltrim($path, '/');
    $file = dirname(__DIR__) . '/' . $path;
    $version = is_file($file) ? (string) filemtime($file) : '1';
    return '/' . $path . '?v=' . $version;
}

/** Returns only the social links that have a real URL. */
function active_social_links(array $config): array
{
    return array_filter(
        $config['social'] ?? [],
        static fn($url) => is_string($url) && preg_match('#^https?://#i', $url)
    );
}

function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('jeo_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

/** CSRF token for the contact form; also records when the form was shown. */
function contact_form_token(): string
{
    if (empty($_SESSION['contact_token'])) {
        $_SESSION['contact_token'] = bin2hex(random_bytes(32));
    }
    $_SESSION['contact_form_time'] = time();
    return $_SESSION['contact_token'];
}

/** Reads (and clears) the result stored after a non-JavaScript form submission. */
function pull_contact_flash(): ?array
{
    if (empty($_SESSION['contact_flash']) || !is_array($_SESSION['contact_flash'])) {
        return null;
    }
    $flash = $_SESSION['contact_flash'];
    unset($_SESSION['contact_flash']);
    return $flash;
}

/** Loads a data file from /data. */
function load_data(string $name): array
{
    $file = dirname(__DIR__) . '/data/' . basename($name) . '.php';
    $data = is_file($file) ? require $file : [];
    return is_array($data) ? $data : [];
}
