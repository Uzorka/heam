<?php
/**
 * Public registry page.
 */

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
start_secure_session();

$site = registry_config()['site'];
$token = csrf_token();
$_SESSION['form_time'] = time();

$items = [];
$dbError = false;
try {
    $items = fetch_items();
} catch (Throwable $e) {
    error_log('Registry page DB error: ' . $e->getMessage());
    $dbError = true;
}

$categories = array_values(array_unique(array_column($items, 'category')));
$today      = date('Y-m-d');
$maxDate    = date('Y-m-d', strtotime('+' . (int) $site['max_days_ahead'] . ' days'));

// Data handed to the JavaScript (prices, availability, settings).
$jsItems = array_map(static fn($i) => [
    'id'        => $i['id'],
    'name'      => $i['name'],
    'emoji'     => $i['emoji'],
    'price'     => $i['price'],
    'open'      => $i['is_open_amount'],
    'remaining' => $i['is_open_amount'] ? null : $i['remaining'],
], $items);
$jsConfig = [
    'currency' => $site['currency'],
    'babyName' => $site['baby_name'],
    'dueDate'  => $site['due_date'],
];

header('Cache-Control: no-store');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($site['baby_name'] . ' – ' . $site['title']) ?></title>
    <meta name="description" content="<?= e($site['headline'] . ' ' . $site['parents'] . ' gift registry.') ?>">
    <meta property="og:title" content="<?= e($site['baby_name'] . ' – ' . $site['title']) ?>">
    <meta property="og:description" content="<?= e($site['headline']) ?>">
    <meta name="theme-color" content="#f6f1ea">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>👶</text></svg>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= e(asset('assets/css/style.css')) ?>">
</head>
<body>

<header class="site-header">
    <nav class="nav container" aria-label="Main">
        <a class="brand" href="#top"><span aria-hidden="true">👶</span> <?= e($site['baby_name']) ?></a>
        <ul class="nav-links">
            <li><a href="#reg">Registry</a></li>
            <li><a href="#how">How it works</a></li>
            <?php if ($site['show_bank_on_page']): ?><li><a href="#bank">Gift details</a></li><?php endif; ?>
        </ul>
    </nav>
</header>

<main id="top">
    <section class="hero">
        <div class="container hero-inner">
            <p class="eyebrow"><?= e($site['parents']) ?></p>
            <h1><?= e($site['headline']) ?></h1>
            <p class="lead"><?= e($site['intro']) ?></p>

            <?php if ($site['due_date']): ?>
            <div class="countdown" id="countdown" data-date="<?= e($site['due_date']) ?>" aria-live="polite">
                <div><strong data-unit="days">–</strong><span>days</span></div>
                <div><strong data-unit="hours">–</strong><span>hours</span></div>
                <div><strong data-unit="minutes">–</strong><span>minutes</span></div>
            </div>
            <p class="due">Expected <?= e(nice_date($site['due_date'])) ?></p>
            <?php endif; ?>

            <a class="btn btn-primary" href="#reg">View the registry</a>
        </div>
        <div class="hero-bubbles" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    </section>

    <section class="section" id="reg">
        <div class="container">
            <h2 class="section-title">Gift Registry</h2>
            <p class="section-sub">Pick something you would love to give. Items that have been fully gifted are marked so nobody doubles up.</p>

            <?php if ($dbError): ?>
                <p class="notice">The registry is being set up. Please check back soon.</p>
            <?php else: ?>
                <?php if (count($categories) > 1): ?>
                <div class="filters" role="group" aria-label="Filter by category">
                    <button type="button" class="chip is-active" data-filter="all">All</button>
                    <?php foreach ($categories as $cat): ?>
                        <button type="button" class="chip" data-filter="<?= e($cat) ?>"><?= e($cat) ?></button>
                    <?php endforeach; ?>
                    <label class="toggle"><input type="checkbox" id="hide-gifted"> Hide gifted items</label>
                </div>
                <?php endif; ?>

                <div class="grid" id="items">
                    <?php foreach ($items as $item):
                        $open = $item['is_open_amount'];
                        $done = !$open && $item['remaining'] === 0;
                        $pct  = $open ? 0 : (int) round(min(1, $item['pledged_qty'] / max(1, $item['quantity_needed'])) * 100);
                        $img  = item_image($item);
                    ?>
                    <article class="card<?= $done ? ' is-done' : '' ?>" data-id="<?= $item['id'] ?>" data-category="<?= e($item['category']) ?>">
                        <div class="card-media">
                            <?php if ($img): ?>
                                <img src="<?= e($img) ?>" alt="" loading="lazy">
                            <?php else: ?>
                                <span class="card-emoji" aria-hidden="true"><?= e($item['emoji']) ?></span>
                            <?php endif; ?>
                            <span class="badge"><?= e($item['category']) ?></span>
                            <span class="ribbon">Gifted 💛</span>
                        </div>
                        <div class="card-body">
                            <h3><?= e($item['name']) ?></h3>
                            <?php if ($item['description']): ?><p class="card-desc"><?= e($item['description']) ?></p><?php endif; ?>
                            <p class="price"><?= $open ? 'Any amount' : e(money($item['price'])) ?></p>

                            <?php if (!$open): ?>
                            <div class="progress" aria-hidden="true"><span style="width: <?= $pct ?>%"></span></div>
                            <p class="stock" data-stock>
                                <?= $done ? 'Fully gifted – thank you!'
                                    : ($item['quantity_needed'] > 1
                                        ? e($item['remaining'] . ' of ' . $item['quantity_needed'] . ' still needed')
                                        : 'Still needed') ?>
                            </p>
                            <?php endif; ?>

                            <button type="button" class="btn btn-primary btn-block" data-gift="<?= $item['id'] ?>"<?= $done ? ' disabled' : '' ?>>
                                <?= $done ? 'Gifted' : 'I will gift this' ?>
                            </button>
                        </div>
                    </article>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </section>

    <section class="section section-alt" id="how">
        <div class="container">
            <h2 class="section-title">How it works</h2>
            <ol class="steps">
                <li><span class="step-icon" aria-hidden="true">🎁</span><h3>Pick a gift</h3><p>Choose an item from the registry, or give any amount to our cash fund.</p></li>
                <li><span class="step-icon" aria-hidden="true">📅</span><h3>Choose a date</h3><p>Fill in your name, phone and email, and pick the day you would like to send it.</p></li>
                <li><span class="step-icon" aria-hidden="true">🔔</span><h3>Get a reminder</h3><p>On that day we will email<?= whatsapp_enabled() ? ' and WhatsApp' : '' ?> you our account details – no need to remember!</p></li>
            </ol>
        </div>
    </section>

    <?php if ($site['show_bank_on_page']): ?>
    <section class="section" id="bank">
        <div class="container narrow">
            <h2 class="section-title">Gift details</h2>
            <p class="section-sub">Prefer to send something right away? You can transfer directly to:</p>
            <div class="bank-list">
                <?php foreach (registry_config()['bank_accounts'] as $acct): ?>
                <div class="bank-card">
                    <p class="bank-name"><?= e($acct['bank_name']) ?></p>
                    <p class="bank-number">
                        <span><?= e($acct['account_number']) ?></span>
                        <button type="button" class="copy" data-copy="<?= e($acct['account_number']) ?>">Copy</button>
                    </p>
                    <p class="bank-holder"><?= e($acct['account_name']) ?></p>
                </div>
                <?php endforeach; ?>
            </div>
        </div>
    </section>
    <?php endif; ?>
</main>

<footer class="site-footer">
    <div class="container">
        <p>Made with love for <?= e($site['baby_name']) ?> · <?= e($site['parents']) ?></p>
    </div>
</footer>

<!-- Pledge form -->
<dialog class="modal" id="pledge-modal" aria-labelledby="modal-title">
    <form class="modal-card" id="pledge-form" method="post" action="api/pledge.php" novalidate>
        <button type="button" class="modal-close" data-close aria-label="Close">×</button>

        <div class="modal-step" data-step="form">
            <div class="modal-head">
                <span class="modal-emoji" id="modal-emoji" aria-hidden="true">🎁</span>
                <div>
                    <p class="eyebrow">You are gifting</p>
                    <h2 id="modal-title">Gift</h2>
                    <p class="modal-price" id="modal-price"></p>
                </div>
            </div>

            <input type="hidden" name="token" value="<?= e($token) ?>">
            <input type="hidden" name="item_id" id="f-item">
            <div class="hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>

            <div class="field" id="field-quantity">
                <label for="f-quantity">Quantity</label>
                <div class="qty">
                    <button type="button" data-qty="-1" aria-label="Fewer">−</button>
                    <input type="number" id="f-quantity" name="quantity" value="1" min="1" inputmode="numeric">
                    <button type="button" data-qty="1" aria-label="More">+</button>
                </div>
                <p class="field-error" data-error="quantity"></p>
            </div>

            <div class="field" id="field-amount">
                <label for="f-amount">Amount (<?= e($site['currency']) ?>)</label>
                <input type="text" id="f-amount" name="amount" inputmode="decimal" placeholder="e.g. 20000">
                <p class="field-error" data-error="amount"></p>
            </div>

            <div class="field">
                <label for="f-name">Full name</label>
                <input type="text" id="f-name" name="full_name" autocomplete="name" required maxlength="120" placeholder="First and last name">
                <p class="field-error" data-error="full_name"></p>
            </div>

            <div class="field-row">
                <div class="field">
                    <label for="f-phone">Phone (WhatsApp)</label>
                    <input type="tel" id="f-phone" name="phone" autocomplete="tel" required placeholder="0803 123 4567">
                    <p class="field-error" data-error="phone"></p>
                </div>
                <div class="field">
                    <label for="f-email">Email</label>
                    <input type="email" id="f-email" name="email" autocomplete="email" required placeholder="you@example.com">
                    <p class="field-error" data-error="email"></p>
                </div>
            </div>

            <div class="field">
                <label for="f-date">When would you like to pay?</label>
                <input type="date" id="f-date" name="payment_date" required min="<?= e($today) ?>" max="<?= e($maxDate) ?>" value="<?= e($today) ?>">
                <p class="hint">We will send you a reminder with the account details on this day.</p>
                <p class="field-error" data-error="payment_date"></p>
            </div>

            <label class="check">
                <input type="checkbox" name="whatsapp" value="1" checked>
                <span>Also send my reminder on WhatsApp</span>
            </label>

            <div class="field">
                <label for="f-message">A note for the family <span class="optional">(optional)</span></label>
                <textarea id="f-message" name="message" rows="3" maxlength="1000" placeholder="Congratulations…"></textarea>
                <p class="field-error" data-error="message"></p>
            </div>

            <p class="form-error" id="form-error" role="alert"></p>
            <button type="submit" class="btn btn-primary btn-block" id="submit-btn">Confirm my gift</button>
        </div>

        <div class="modal-step" data-step="done" hidden>
            <div class="done">
                <div class="done-icon" aria-hidden="true">💛</div>
                <h2>Thank you!</h2>
                <p id="done-text"></p>
                <dl class="summary" id="done-summary"></dl>
                <p class="hint" id="done-email"></p>
                <div class="done-actions">
                    <a class="btn btn-ghost" id="calendar-link" download="gift-reminder.ics">Add to my calendar</a>
                    <button type="button" class="btn btn-primary" data-close>Done</button>
                </div>
            </div>
        </div>
    </form>
</dialog>

<script>window.REGISTRY = <?= json_encode(['items' => $jsItems, 'config' => $jsConfig], JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) ?>;</script>
<script src="<?= e(asset('assets/js/registry.js')) ?>" defer></script>
</body>
</html>
