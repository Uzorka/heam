<?php
/**
 * Small shared helpers.
 */

declare(strict_types=1);

/** Stores the config on first call and returns it afterwards. */
function registry_config(?array $set = null): array
{
    static $config = [];
    if ($set !== null) {
        $config = $set;
    }
    return $config;
}

/** Escape a value for HTML output. */
function e($value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function money(float $amount): string
{
    $decimals = floor($amount) == $amount ? 0 : 2;
    return registry_config()['site']['currency'] . number_format($amount, $decimals);
}

function nice_date(string $date): string
{
    $ts = strtotime($date);
    return $ts ? date('l, j F Y', $ts) : $date;
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443')
        || (strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

/** Public address of the registry without a trailing slash, e.g. https://site.com/registry */
function registry_url(): string
{
    $configured = registry_config()['site']['url'] ?? '';
    if ($configured !== '') {
        return rtrim($configured, '/');
    }

    $host = strtolower($_SERVER['HTTP_HOST'] ?? 'localhost');
    if (!preg_match('/^[a-z0-9.\-]+(:\d+)?$/', $host)) {
        $host = 'localhost';
    }

    // Work out the folder the registry lives in from this file's location.
    $docRoot = rtrim(str_replace('\\', '/', (string) realpath($_SERVER['DOCUMENT_ROOT'] ?? '')), '/');
    $root    = str_replace('\\', '/', REGISTRY_ROOT);
    $path    = ($docRoot !== '' && str_starts_with($root, $docRoot)) ? substr($root, strlen($docRoot)) : '';

    return (is_https() ? 'https://' : 'http://') . $host . rtrim($path, '/');
}

/** Asset path relative to the current page, with a version string for caching. */
function asset(string $path, string $prefix = ''): string
{
    $file = REGISTRY_ROOT . '/' . ltrim($path, '/');
    $version = is_file($file) ? (string) filemtime($file) : '1';
    return $prefix . ltrim($path, '/') . '?v=' . $version;
}

/** Image URL for an item (uploaded file or external link). */
function item_image(array $item, string $prefix = ''): string
{
    $image = (string) ($item['image'] ?? '');
    if ($image === '') {
        return '';
    }
    return preg_match('#^https?://#i', $image) ? $image : $prefix . ltrim($image, '/');
}

/**
 * Normalises a phone number to international digits without "+",
 * e.g. "0803 123 4567" -> "2348031234567". Returns '' when invalid.
 */
function normalize_phone(string $phone): string
{
    $phone = trim($phone);
    $hasPlus = str_starts_with($phone, '+');
    $digits = preg_replace('/\D+/', '', $phone);

    if ($digits === '') {
        return '';
    }
    if (!$hasPlus && str_starts_with($digits, '00')) {
        $digits = substr($digits, 2);
    } elseif (!$hasPlus && str_starts_with($digits, '0')) {
        $digits = registry_config()['whatsapp']['default_country_code'] . substr($digits, 1);
    }

    return (strlen($digits) >= 8 && strlen($digits) <= 15) ? $digits : '';
}

function display_phone(string $digits): string
{
    return $digits === '' ? '' : '+' . $digits;
}

function client_ip(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '';
}

function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('baby_registry');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_valid(?string $token): bool
{
    return is_string($token) && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $token);
}

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Bank accounts as plain text lines (for email text and WhatsApp). */
function bank_details_text(): string
{
    $lines = [];
    foreach (registry_config()['bank_accounts'] as $acct) {
        $lines[] = "Bank: {$acct['bank_name']}\nAccount name: {$acct['account_name']}\nAccount number: {$acct['account_number']}";
    }
    return implode("\n\n", $lines);
}

/** Bank accounts on a single line each (WhatsApp template parameters cannot contain new lines). */
function bank_details_inline(): string
{
    $parts = [];
    foreach (registry_config()['bank_accounts'] as $acct) {
        $parts[] = "{$acct['bank_name']} – {$acct['account_number']} ({$acct['account_name']})";
    }
    return implode(' | ', $parts);
}

/** What the guest pledged, e.g. "2 × Diapers (big pack)" with the total. */
function pledge_summary(array $pledge): array
{
    $qty   = (int) $pledge['quantity'];
    $label = ($qty > 1 ? $qty . ' × ' : '') . $pledge['item_name'];
    return ['label' => $label, 'amount' => money((float) $pledge['amount'])];
}
