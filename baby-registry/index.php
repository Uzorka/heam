<?php
/**
 * Public page: balloon-pop gender guess, the registry, wishes wall and gift details.
 */

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
start_secure_session();

$site  = registry_config()['site'];
$token = csrf_token();
$_SESSION['form_time'] = time();
$visitor = visitor_id();

$items   = [];
$wishes  = [];
$reveal  = ['revealed' => false, 'gender' => null];
$tally   = ['boy' => 0, 'girl' => 0, 'total' => 0];
$myGuess = null;
$dbError = false;
try {
    $items   = fetch_items();
    $reveal  = reveal_state();
    $tally   = guess_tally();
    $myGuess = visitor_guess($visitor)['guess'] ?? null;
    $wishes  = fetch_wishes();
} catch (Throwable $e) {
    error_log('Registry page DB error: ' . $e->getMessage());
    $dbError = true;
}

// Group items by category, keeping the admin's display order.
$groups = [];
foreach ($items as $item) {
    $groups[$item['category']][] = $item;
}
$slug = static fn(string $s): string => 'cat-' . trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($s)), '-');

$fixedItems = array_filter($items, static fn($i) => !$i['is_open_amount']);
$giftsTaken = count(array_filter($fixedItems, static fn($i) => $i['remaining'] === 0));

$today   = date('Y-m-d');
$maxDate = date('Y-m-d', strtotime('+' . (int) $site['max_days_ahead'] . ' days'));

// Everything the JavaScript needs. The baby's gender is only included once revealed.
$jsData = [
    'token'   => $token,
    'items'   => array_values(array_map(static fn($i) => [
        'id'        => $i['id'],
        'name'      => $i['name'],
        'emoji'     => $i['emoji'],
        'price'     => $i['price'],
        'open'      => $i['is_open_amount'],
        'remaining' => $i['is_open_amount'] ? null : $i['remaining'],
    ], $items)),
    'config'  => [
        'currency'   => $site['currency'],
        'babyName'   => $site['baby_name'],
        'familyName' => $site['family_name'],
        'dueDate'    => $site['due_date'],
        'revealDate' => $site['reveal_date'],
        'today'      => $today,
        'maxDate'    => $maxDate,
    ],
    'reveal'  => $reveal,
    'tally'   => $tally,
    'myGuess' => $myGuess,
];

header('Cache-Control: no-store');
?>
<!doctype html>
<html lang="en" data-theme="neutral">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title><?= e($site['headline']) ?></title>
    <meta name="description" content="<?= e('The ' . $site['family_name'] . ' are expecting! Guess boy or girl, pop the balloon and see the baby registry.') ?>">
    <meta property="og:title" content="<?= e('The ' . $site['family_name'] . ' are expecting 🎈') ?>">
    <meta property="og:description" content="Boy or girl? Make your guess, pop the balloon and see the baby registry.">
    <meta name="theme-color" content="#161514">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎈</text></svg>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= e(asset('assets/css/style.css')) ?>">
</head>
<body>

<canvas id="confetti" aria-hidden="true"></canvas>

<!-- ===================================================================== -->
<!-- Intro: guess, then pop the balloon                                     -->
<!-- ===================================================================== -->
<section class="intro" id="intro">
    <div class="stage" id="stage">
        <p class="kicker">You're invited to find out</p>
        <h1 class="family">The <?= e($site['family_name']) ?></h1>
        <p class="tagline">are expecting</p>

        <div class="balloon-wrap" id="balloon-wrap">
            <button type="button" class="balloon" id="balloon" aria-label="Pop the balloon" aria-describedby="balloon-hint">
                <svg viewBox="0 0 200 300" aria-hidden="true">
                    <defs>
                        <radialGradient id="bfill" cx="38%" cy="32%" r="70%">
                            <stop offset="0" stop-color="var(--balloon-hi)" />
                            <stop offset="1" stop-color="var(--balloon-lo)" />
                        </radialGradient>
                    </defs>
                    <ellipse class="b-body" cx="100" cy="105" rx="78" ry="96" />
                    <path class="b-shine" d="M58 62 Q70 38 96 32" />
                    <path class="b-knot" d="M92 200 L108 200 L100 212 Z" />
                    <text class="b-mark" x="100" y="128" text-anchor="middle">?</text>
                    <path class="b-string" d="M100 212 C 88 235, 114 255, 98 296" />
                </svg>
            </button>
            <div class="shards" id="shards" aria-hidden="true"></div>
        </div>

        <p class="balloon-hint" id="balloon-hint">Boy or girl? Make your guess, then tap the balloon</p>

        <div class="guess" id="guess-panel">
            <div class="guess-options" role="group" aria-label="Your guess">
                <button type="button" class="guess-btn" data-guess="boy"><span aria-hidden="true">💙</span> Boy</button>
                <button type="button" class="guess-btn" data-guess="girl"><span aria-hidden="true">💗</span> Girl</button>
            </div>
            <form class="guess-form" id="guess-form" hidden>
                <input type="text" name="name" maxlength="60" placeholder="Your name (optional)" autocomplete="name">
                <textarea name="message" maxlength="300" rows="2" placeholder="Leave a wish for the baby (optional)"></textarea>
                <div class="hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
                <button type="submit" class="btn btn-light" id="guess-submit">Lock in my guess</button>
                <p class="guess-error" id="guess-error" role="alert"></p>
            </form>
        </div>

        <p class="tally-mini" id="tally-mini"></p>
    </div>

    <div class="result" id="result" hidden aria-live="polite">
        <p class="kicker" id="result-kicker"></p>
        <h2 class="result-title" id="result-title"></h2>
        <p class="result-sub" id="result-sub"></p>
        <p class="result-you" id="result-you"></p>

        <div class="tally" id="tally">
            <div class="tally-row"><span>💙 Boy</span><div class="tally-bar"><span data-bar="boy"></span></div><strong data-pct="boy">0%</strong></div>
            <div class="tally-row"><span>💗 Girl</span><div class="tally-bar"><span data-bar="girl"></span></div><strong data-pct="girl">0%</strong></div>
            <p class="tally-total" id="tally-total"></p>
        </div>

        <p class="result-countdown" id="result-countdown"></p>

        <a class="btn btn-light btn-lg" href="#reg">See the baby registry</a>
        <button type="button" class="link-btn" id="replay">🎈 Pop it again</button>
    </div>

    <a class="skip" href="#reg">Skip to the registry ↓</a>
</section>

<main>
    <!-- ================================================================= -->
    <!-- Registry                                                          -->
    <!-- ================================================================= -->
    <section class="registry" id="reg">
        <div class="container">
            <h2 class="page-title"><?= e($site['headline']) ?></h2>
            <p class="page-intro"><?= e($site['intro']) ?></p>

            <?php if (!$dbError && $fixedItems): ?>
            <div class="progress-card">
                <div class="progress-top">
                    <span><strong id="taken-count"><?= $giftsTaken ?></strong> of <?= count($fixedItems) ?> gifts taken</span>
                    <?php if ($site['due_date']): ?><span class="due" data-due="<?= e($site['due_date']) ?>"></span><?php endif; ?>
                </div>
                <div class="progress-line"><span id="taken-bar" style="width: <?= (int) round($giftsTaken / max(1, count($fixedItems)) * 100) ?>%"></span></div>
            </div>
            <?php endif; ?>
        </div>

        <?php if ($dbError): ?>
            <p class="container notice">The registry is being set up. Please check back soon.</p>
        <?php else: ?>
        <nav class="cat-nav" id="cat-nav" aria-label="Categories">
            <div class="cat-nav-inner">
                <?php foreach (array_keys($groups) as $cat): ?>
                    <a href="#<?= e($slug($cat)) ?>" data-target="<?= e($slug($cat)) ?>"><?= e($cat) ?></a>
                <?php endforeach; ?>
                <label class="hide-taken"><input type="checkbox" id="hide-taken"> Hide taken</label>
            </div>
        </nav>

        <div class="container">
            <?php foreach ($groups as $cat => $catItems): ?>
            <section class="cat" id="<?= e($slug($cat)) ?>">
                <h3 class="cat-title"><?= e($cat) ?></h3>
                <ul class="rows">
                    <?php foreach ($catItems as $item):
                        $open   = $item['is_open_amount'];
                        $done   = !$open && $item['remaining'] === 0;
                        $multi  = !$open && $item['quantity_needed'] > 1;
                        $img    = item_image($item);
                        $bits   = [];
                        if ($item['description'] !== '') { $bits[] = $item['description']; }
                        if ($open || $item['price'] <= 0) { $bits[] = 'Any amount'; }
                        else { $bits[] = money($item['price']) . ($multi ? ' each' : ''); }
                    ?>
                    <li class="row<?= $done ? ' is-done' : '' ?>" data-id="<?= $item['id'] ?>">
                        <?php if ($img): ?><img class="row-img" src="<?= e($img) ?>" alt="" loading="lazy"><?php endif; ?>
                        <div class="row-main">
                            <span class="row-name"><?= e($item['name']) ?></span>
                            <span class="row-sub"><?= e(implode(' · ', $bits)) ?></span>
                            <?php if ($multi): ?>
                            <span class="row-stock" data-stock data-total="<?= $item['quantity_needed'] ?>">
                                <span class="mini-bar"><span style="width: <?= (int) round($item['pledged_qty'] / $item['quantity_needed'] * 100) ?>%"></span></span>
                                <span data-stock-text><?= $done ? 'All taken' : e($item['remaining'] . ' of ' . $item['quantity_needed'] . ' still needed') ?></span>
                            </span>
                            <?php endif; ?>
                        </div>
                        <button type="button" class="pill" data-gift="<?= $item['id'] ?>"<?= $done ? ' disabled' : '' ?>>
                            <?= $done ? 'Taken ✓' : "I'll get this" ?>
                        </button>
                    </li>
                    <?php endforeach; ?>
                </ul>
            </section>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>
    </section>

    <!-- ================================================================= -->
    <!-- Wishes wall                                                       -->
    <!-- ================================================================= -->
    <section class="section" id="wishes">
        <div class="container">
            <p class="kicker center">Love notes</p>
            <h2 class="section-title">Wishes for the baby</h2>
            <div class="wall" id="wall">
                <?php foreach ($wishes as $w): ?>
                <figure class="wish">
                    <blockquote><?= nl2br(e($w['message'])) ?></blockquote>
                    <figcaption>
                        <?= e($w['name'] !== '' ? $w['name'] : 'A loved one') ?>
                        <?php if ($w['source'] === 'guess'): ?>
                            <span class="tag"><?= $w['guess'] === 'boy' ? '💙 guessed boy' : '💗 guessed girl' ?></span>
                        <?php else: ?>
                            <span class="tag">🎁 sent a gift</span>
                        <?php endif; ?>
                    </figcaption>
                </figure>
                <?php endforeach; ?>
            </div>
            <p class="wall-empty" id="wall-empty"<?= $wishes ? ' hidden' : '' ?>>No wishes yet. Be the first! Add one with your guess or your gift.</p>
        </div>
    </section>

    <!-- ================================================================= -->
    <!-- How it works + bank details                                       -->
    <!-- ================================================================= -->
    <section class="section">
        <div class="container narrow">
            <h2 class="section-title">How it works</h2>
            <ol class="steps">
                <li><span>1</span><div><strong>Pick a gift</strong><p>Tap "I'll get this" on anything in the registry.</p></div></li>
                <li><span>2</span><div><strong>Choose a day</strong><p>Tell us your name, phone, email and the day you would like to send it.</p></div></li>
                <li><span>3</span><div><strong>We remind you</strong><p>On that day we will send you our account details by email<?= whatsapp_enabled() ? ' and WhatsApp' : '' ?>.</p></div></li>
            </ol>

            <?php if ($site['show_bank_on_page']): ?>
            <div class="bank" id="bank">
                <p class="kicker">Prefer to send it now?</p>
                <?php foreach (registry_config()['bank_accounts'] as $acct): ?>
                <div class="bank-card">
                    <p class="bank-name"><?= e($acct['bank_name']) ?></p>
                    <p class="bank-number"><?= e($acct['account_number']) ?></p>
                    <p class="bank-holder"><?= e($acct['account_name']) ?></p>
                    <button type="button" class="pill pill-sm" data-copy="<?= e($acct['account_number']) ?>">Copy number</button>
                </div>
                <?php endforeach; ?>
            </div>
            <?php endif; ?>
        </div>
    </section>
</main>

<footer class="footer">
    <p>Made with love for <?= e($site['baby_name']) ?> · <?= e($site['parents']) ?></p>
    <a href="#intro" class="link-btn">🎈 Back to the balloon</a>
</footer>

<!-- ===================================================================== -->
<!-- Pledge form (bottom sheet)                                            -->
<!-- ===================================================================== -->
<dialog class="sheet" id="pledge-modal" aria-labelledby="modal-title">
    <form class="sheet-card" id="pledge-form" method="post" action="api/pledge.php" novalidate>
        <span class="sheet-grip" aria-hidden="true"></span>
        <button type="button" class="sheet-close" data-close aria-label="Close">×</button>

        <div data-step="form">
            <div class="sheet-head">
                <span class="sheet-emoji" id="modal-emoji" aria-hidden="true">🎁</span>
                <div>
                    <p class="kicker">You're getting</p>
                    <h2 id="modal-title">Gift</h2>
                    <p class="sheet-price" id="modal-price"></p>
                </div>
            </div>

            <input type="hidden" name="token" value="<?= e($token) ?>">
            <input type="hidden" name="item_id" id="f-item">
            <div class="hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>

            <div class="field" id="field-quantity">
                <label for="f-quantity">How many?</label>
                <div class="qty">
                    <button type="button" data-qty="-1" aria-label="Fewer">−</button>
                    <input type="number" id="f-quantity" name="quantity" value="1" min="1" inputmode="numeric">
                    <button type="button" data-qty="1" aria-label="More">+</button>
                </div>
                <p class="field-error" data-error="quantity"></p>
            </div>

            <div class="field" id="field-amount">
                <label for="f-amount">Amount you'd like to send (<?= e($site['currency']) ?>)</label>
                <input type="text" id="f-amount" name="amount" inputmode="decimal" placeholder="e.g. 20,000">
                <div class="chips" id="amount-chips">
                    <?php foreach ([5000, 10000, 20000, 50000] as $amt): ?>
                        <button type="button" class="chip" data-amount="<?= $amt ?>"><?= e(money($amt)) ?></button>
                    <?php endforeach; ?>
                </div>
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
                <label for="f-date">When will you send it?</label>
                <div class="chips" id="date-chips"></div>
                <input type="date" id="f-date" name="payment_date" required min="<?= e($today) ?>" max="<?= e($maxDate) ?>" value="<?= e($today) ?>">
                <p class="hint" id="date-hint">We'll remind you with our account details on this day.</p>
                <p class="field-error" data-error="payment_date"></p>
            </div>

            <label class="check">
                <input type="checkbox" name="whatsapp" value="1" checked>
                <span>Also remind me on WhatsApp</span>
            </label>

            <div class="field">
                <label for="f-message">A note for the family <span class="optional">(optional)</span></label>
                <textarea id="f-message" name="message" rows="2" maxlength="1000" placeholder="Congratulations…"></textarea>
                <label class="check check-sm"><input type="checkbox" name="share_message" value="1" checked> <span>Show my note on the wishes wall</span></label>
                <p class="field-error" data-error="message"></p>
            </div>

            <p class="form-error" id="form-error" role="alert"></p>
            <button type="submit" class="btn btn-accent btn-block" id="submit-btn">Confirm my gift</button>
        </div>

        <div data-step="done" hidden>
            <div class="done">
                <div class="done-icon" aria-hidden="true">🎉</div>
                <h2>Thank you!</h2>
                <p id="done-text"></p>
                <dl class="summary" id="done-summary"></dl>
                <p class="hint" id="done-email"></p>
                <div class="done-actions">
                    <a class="btn btn-ghost" id="calendar-link" download="gift-reminder.ics">📅 Add to calendar</a>
                    <button type="button" class="btn btn-accent" data-close>Done</button>
                </div>
            </div>
        </div>
    </form>
</dialog>

<script>window.REGISTRY = <?= json_encode($jsData, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) ?>;</script>
<script src="<?= e(asset('assets/js/registry.js')) ?>" defer></script>
</body>
</html>
