<?php
/**
 * Database connection (PDO + MySQL) and registry queries.
 */

declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $c   = registry_config()['db'];
    $dsn = 'mysql:host=' . $c['host'] . ';dbname=' . $c['name'] . ';charset=utf8mb4';
    $pdo = new PDO($dsn, $c['user'], $c['password'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);

    // Keep MySQL's NOW() in the same timezone as PHP.
    $pdo->exec("SET time_zone = '" . (new DateTime())->format('P') . "'");

    return $pdo;
}

/** SQL fragment: how many of an item have been pledged (pending or paid). */
const PLEDGED_QTY_SQL = "(SELECT COALESCE(SUM(p.quantity), 0) FROM pledges p
                          WHERE p.item_id = i.id AND p.status IN ('pending', 'paid'))";

/** Active items with how many are still available. */
function fetch_items(bool $includeInactive = false): array
{
    $sql = 'SELECT i.*, ' . PLEDGED_QTY_SQL . ' AS pledged_qty,
                   (SELECT COALESCE(SUM(p.amount), 0) FROM pledges p
                     WHERE p.item_id = i.id AND p.status IN (\'pending\', \'paid\')) AS pledged_amount
            FROM items i'
         . ($includeInactive ? '' : ' WHERE i.is_active = 1')
         . ' ORDER BY i.sort_order, i.id';

    $items = db()->query($sql)->fetchAll();
    return array_map('decorate_item', $items);
}

function fetch_item(int $id): ?array
{
    $stmt = db()->prepare('SELECT i.*, ' . PLEDGED_QTY_SQL . ' AS pledged_qty, 0 AS pledged_amount FROM items i WHERE i.id = ?');
    $stmt->execute([$id]);
    $item = $stmt->fetch();
    return $item ? decorate_item($item) : null;
}

/** Adds the derived "remaining" value used by the page and the API. */
function decorate_item(array $item): array
{
    $item['id']              = (int) $item['id'];
    $item['price']           = (float) $item['price'];
    $item['quantity_needed'] = (int) $item['quantity_needed'];
    $item['pledged_qty']     = (int) $item['pledged_qty'];
    $item['is_open_amount']  = (bool) $item['is_open_amount'];
    $item['remaining']       = $item['is_open_amount']
        ? PHP_INT_MAX
        : max(0, $item['quantity_needed'] - $item['pledged_qty']);
    return $item;
}

function fetch_pledge(int $id): ?array
{
    $stmt = db()->prepare(
        'SELECT p.*, i.name AS item_name, i.emoji AS item_emoji, i.price AS item_price, i.is_open_amount
         FROM pledges p JOIN items i ON i.id = p.item_id WHERE p.id = ?'
    );
    $stmt->execute([$id]);
    return $stmt->fetch() ?: null;
}

/** A short, readable reference such as "BR-7K3QX9" that guests can quote. */
function new_pledge_reference(): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $ref = '';
        for ($i = 0; $i < 6; $i++) {
            $ref .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $ref = 'BR-' . $ref;
        $stmt = db()->prepare('SELECT 1 FROM pledges WHERE reference = ?');
        $stmt->execute([$ref]);
    } while ($stmt->fetchColumn());
    return $ref;
}

function log_notification(?int $pledgeId, string $channel, string $type, string $recipient, bool $success, string $detail = ''): void
{
    try {
        db()->prepare('INSERT INTO notification_log (pledge_id, channel, type, recipient, success, detail) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$pledgeId, $channel, $type, $recipient, $success ? 1 : 0, mb_substr($detail, 0, 500)]);
    } catch (Throwable $e) {
        error_log('Registry: could not write notification log: ' . $e->getMessage());
    }
}

/* ---- Settings changed from the admin ------------------------------------ */

function get_setting(string $name, string $default = ''): string
{
    try {
        $stmt = db()->prepare('SELECT value FROM settings WHERE name = ?');
        $stmt->execute([$name]);
        $value = $stmt->fetchColumn();
        return $value === false ? $default : (string) $value;
    } catch (Throwable $e) {
        return $default;
    }
}

function set_setting(string $name, string $value): void
{
    db()->prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
        ->execute([$name, $value]);
}

/**
 * The reveal state. 'gender' is only filled in once the admin has revealed it,
 * so the answer can never leak to the browser early.
 */
function reveal_state(): array
{
    $gender   = get_setting('baby_gender');
    $revealed = get_setting('revealed') === '1' && in_array($gender, ['boy', 'girl'], true);
    return ['revealed' => $revealed, 'gender' => $revealed ? $gender : null];
}

/* ---- Gender guesses ------------------------------------------------------ */

function guess_tally(): array
{
    $rows = db()->query('SELECT guess, COUNT(*) AS n FROM gender_guesses GROUP BY guess')->fetchAll(PDO::FETCH_KEY_PAIR);
    $boy  = (int) ($rows['boy'] ?? 0);
    $girl = (int) ($rows['girl'] ?? 0);
    return ['boy' => $boy, 'girl' => $girl, 'total' => $boy + $girl];
}

function visitor_guess(string $visitorId): ?array
{
    if ($visitorId === '') {
        return null;
    }
    $stmt = db()->prepare('SELECT guess, name FROM gender_guesses WHERE visitor_id = ?');
    $stmt->execute([$visitorId]);
    return $stmt->fetch() ?: null;
}

/** Notes from guesses and pledges that may be shown on the wishes wall, newest first. */
function fetch_wishes(int $limit = 60): array
{
    $sql = "(SELECT 'guess' AS source, g.id, g.name, g.message, g.guess, g.created_at
             FROM gender_guesses g WHERE g.is_hidden = 0 AND g.message <> '')
            UNION ALL
            (SELECT 'pledge' AS source, p.id, p.full_name AS name, p.message, NULL AS guess, p.created_at
             FROM pledges p WHERE p.share_message = 1 AND p.message <> '' AND p.status <> 'cancelled')
            ORDER BY created_at DESC LIMIT " . (int) $limit;
    return db()->query($sql)->fetchAll();
}
