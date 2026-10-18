<?php
/**
 * Public page, shown as a sequence of screens:
 *   welcome → guess (boy/girl, baby name, wish) → pop the balloon → result → registry
 * The registry only appears after the guess (or via the small "skip" link).
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

// Everything the JavaScript needs. No prices, and the baby's gender only once revealed.
$jsData = [
    'token'   => $token,
    'items'   => array_values(array_map(static fn($i) => [
        'id'        => $i['id'],
        'name'      => $i['name'],
        'emoji'     => $i['emoji'],
        'open'      => $i['is_open_amount'],
        'remaining' => $i['is_open_amount'] ? null : $i['remaining'],
    ], $items)),
    'config'  => [
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
    <title><?= e('The ' . $site['family_name'] . ' are expecting') ?></title>
    <meta name="description" content="Boy or girl? Take a guess, pop the balloon and see the baby registry.">
    <meta property="og:title" content="<?= e('The ' . $site['family_name'] . ' are expecting 🎈') ?>">
    <meta property="og:description" content="Boy or girl? Take a guess, pop the balloon and see the baby registry.">
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
<!-- 1. Welcome                                                             -->
<!-- ===================================================================== -->
<section class="screen screen-center" id="welcome" aria-labelledby="welcome-title">
    <div class="glow" aria-hidden="true"></div>
    <div class="stage">
        <p class="kicker">You're invited to find out</p>
        <h1 class="family" id="welcome-title"><span class="welcome-to">Welcome to the</span> <?= e($site['family_name']) ?></h1>
        <p class="tagline">family. We are expecting a little one!</p>

        <div class="balloon-wrap balloon-small" aria-hidden="true">
            <?php include __DIR__ . '/includes/balloon.svg.php'; ?>
        </div>

        <p class="welcome-q" id="welcome-q">Boy or girl? What do you think?</p>
        <a class="btn btn-light btn-huge" href="#guess" id="welcome-cta">Take a guess 🎈</a>
        <p class="tally-mini" id="tally-mini"></p>
        <a class="skip" href="#registry" id="welcome-skip">Skip to the baby registry</a>
    </div>
</section>

<!-- ===================================================================== -->
<!-- 2. Guess                                                               -->
<!-- ===================================================================== -->
<section class="screen" id="guess" hidden aria-labelledby="guess-title">
    <div class="stage stage-form">
        <div class="topbar"><a href="#welcome" class="back" aria-label="Back to the welcome screen">←</a><span class="step">Step 1 of 2</span></div>
        <h2 class="screen-title" id="guess-title">Boy or girl?</h2>
        <p class="screen-sub">Make your guess. You'll pop the balloon next.</p>

        <form id="guess-form" novalidate>
            <div class="pick" role="radiogroup" aria-label="Your guess">
                <button type="button" class="pick-card" data-guess="boy" role="radio" aria-checked="false">
                    <span class="pick-emoji" aria-hidden="true">💙</span><span class="pick-label">Boy</span>
                </button>
                <button type="button" class="pick-card" data-guess="girl" role="radio" aria-checked="false">
                    <span class="pick-emoji" aria-hidden="true">💗</span><span class="pick-label">Girl</span>
                </button>
            </div>
            <p class="field-error center" data-error="guess"></p>

            <div class="field">
                <label for="g-baby-name">Suggest a name for the baby <span class="optional">(optional)</span></label>
                <input type="text" id="g-baby-name" name="baby_name" maxlength="60" placeholder="Pick boy or girl first" autocomplete="off">
            </div>
            <div class="field">
                <label for="g-name">Your name</label>
                <input type="text" id="g-name" name="name" maxlength="60" autocomplete="name" placeholder="So the family knows it's you">
            </div>
            <div class="field">
                <label for="g-wish">Make a wish for the baby <span class="optional">(optional)</span></label>
                <textarea id="g-wish" name="message" maxlength="300" rows="3" placeholder="May you grow up surrounded by love…"></textarea>
            </div>

            <fieldset class="notify" id="notify-box">
                <legend>Want to know when it's revealed?</legend>
                <p class="hint">Leave your email or WhatsApp and we'll tell you if you guessed right. Both are optional.</p>
                <div class="field-row">
                    <div class="field">
                        <label for="g-email">Email</label>
                        <input type="email" id="g-email" name="email" autocomplete="email" placeholder="you@example.com">
                        <p class="field-error" data-error="email"></p>
                    </div>
                    <div class="field">
                        <label for="g-phone">WhatsApp number</label>
                        <input type="tel" id="g-phone" name="phone" autocomplete="tel" placeholder="0803 123 4567">
                        <p class="field-error" data-error="phone"></p>
                    </div>
                </div>
            </fieldset>

            <div class="hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
            <p class="form-error" id="guess-error" role="alert"></p>
            <button type="submit" class="btn btn-light btn-huge btn-block" id="guess-submit">Lock in my guess</button>
        </form>
    </div>
</section>

<!-- ===================================================================== -->
<!-- 3. Pop the balloon                                                     -->
<!-- ===================================================================== -->
<section class="screen screen-center" id="pop" hidden aria-labelledby="pop-title">
    <div class="glow" aria-hidden="true"></div>
    <div class="stage">
        <div class="topbar"><span></span><span class="step">Step 2 of 2</span></div>
        <h2 class="screen-title" id="pop-title">Now pop the balloon!</h2>
        <p class="screen-sub" id="pop-sub"></p>
        <div class="balloon-wrap">
            <button type="button" class="balloon" id="balloon" aria-label="Pop the balloon">
                <?php include __DIR__ . '/includes/balloon.svg.php'; ?>
            </button>
            <div class="shards" id="shards" aria-hidden="true"></div>
        </div>
        <p class="balloon-hint">Tap the balloon 👆</p>
    </div>
</section>

<!-- ===================================================================== -->
<!-- 4. Result                                                              -->
<!-- ===================================================================== -->
<section class="screen screen-center" id="result" hidden aria-live="polite">
    <div class="glow" aria-hidden="true"></div>
    <div class="stage">
        <p class="kicker" id="result-kicker"></p>
        <h2 class="result-title" id="result-title"></h2>
        <p class="result-sub" id="result-sub"></p>
        <p class="result-you" id="result-you"></p>
        <p class="result-notify" id="result-notify"></p>

        <div class="tally" id="tally">
            <div class="tally-row"><span>💙 Boy</span><div class="tally-bar"><span data-bar="boy"></span></div><strong data-pct="boy">0%</strong></div>
            <div class="tally-row"><span>💗 Girl</span><div class="tally-bar"><span data-bar="girl"></span></div><strong data-pct="girl">0%</strong></div>
            <p class="tally-total" id="tally-total"></p>
        </div>

        <p class="result-countdown" id="result-countdown"></p>
        <a class="btn btn-light btn-huge" href="#registry">See the baby registry →</a>
        <button type="button" class="link-btn" id="replay">🎈 Pop it again</button>
    </div>
</section>

<!-- ===================================================================== -->
<!-- 5. Registry                                                            -->
<!-- ===================================================================== -->
<div class="screen screen-registry" id="registry" hidden>
    <section class="registry" id="reg" aria-labelledby="reg-title">
        <div class="container">
            <div class="topbar"><a href="#welcome" class="back" aria-label="Back to the balloon">← 🎈</a><span></span></div>
            <h2 class="page-title" id="reg-title"><?= e($site['headline']) ?></h2>
            <p class="page-intro"><?= e($site['intro']) ?></p>
            <?php if ($site['due_date']): ?><p class="due" data-due="<?= e($site['due_date']) ?>"></p><?php endif; ?>
        </div>

        <?php if ($dbError): ?>
            <p class="container notice">The registry is being set up. Please check back soon.</p>
        <?php else: ?>
        <nav class="cat-nav" id="cat-nav" aria-label="Categories">
            <div class="cat-nav-inner">
                <?php foreach (array_keys($groups) as $cat): ?>
                    <a href="#<?= e($slug($cat)) ?>" data-target="<?= e($slug($cat)) ?>"><?= e($cat) ?></a>
                <?php endforeach; ?>
                <label class="hide-taken"><input type="checkbox" id="hide-taken"> Hide picked</label>
            </div>
        </nav>

        <div class="container">
            <?php foreach ($groups as $cat => $catItems): ?>
            <section class="cat" id="<?= e($slug($cat)) ?>">
                <h3 class="cat-title"><?= e($cat) ?></h3>
                <ul class="rows">
                    <?php foreach ($catItems as $n => $item):
                        $done = !$item['is_open_amount'] && $item['remaining'] === 0;
                        $img  = item_image($item);
                    ?>
                    <li class="row<?= $done ? ' is-done' : '' ?>" data-id="<?= $item['id'] ?>" style="--i: <?= min($n, 12) ?>">
                        <?php if ($img): ?><img class="row-img" src="<?= e($img) ?>" alt="" loading="lazy"><?php endif; ?>
                        <div class="row-main">
                            <span class="row-name"><?= e($item['name']) ?></span>
                            <?php if ($item['description'] !== ''): ?><span class="row-sub"><?= e($item['description']) ?></span><?php endif; ?>
                            <span class="row-taken">Someone has picked this 💛</span>
                        </div>
                        <button type="button" class="pill" data-gift="<?= $item['id'] ?>" aria-pressed="false"<?= $done ? ' disabled' : '' ?>>
                            <?= $done ? 'Picked' : "I'll get this" ?>
                        </button>
                    </li>
                    <?php endforeach; ?>
                </ul>
            </section>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>
    </section>

    <section class="section" id="wishes" aria-labelledby="wishes-title">
        <div class="container">
            <p class="kicker center">Love notes</p>
            <h2 class="section-title" id="wishes-title">Wishes for the baby</h2>
            <div class="wall" id="wall">
                <?php foreach ($wishes as $w): ?>
                <figure class="wish">
                    <?php if ($w['message'] !== ''): ?><blockquote><?= nl2br(e($w['message'])) ?></blockquote><?php endif; ?>
                    <figcaption>
                        <?= e($w['name'] !== '' ? $w['name'] : 'A loved one') ?>
                        <?php if ($w['source'] === 'guess'): ?>
                            <span class="tag"><?= $w['guess'] === 'boy' ? '💙 guessed boy' : '💗 guessed girl' ?></span>
                            <?php if ($w['baby_name'] !== ''): ?><span class="tag">suggests “<?= e($w['baby_name']) ?>”</span><?php endif; ?>
                        <?php else: ?>
                            <span class="tag">🎁 picked a gift</span>
                        <?php endif; ?>
                    </figcaption>
                </figure>
                <?php endforeach; ?>
            </div>
            <p class="wall-empty" id="wall-empty"<?= $wishes ? ' hidden' : '' ?>>No wishes yet. Be the first!</p>
        </div>
    </section>

    <section class="section">
        <div class="container narrow">
            <h2 class="section-title">How it works</h2>
            <ol class="steps">
                <li><span>1</span><div><strong>Choose your gifts</strong><p>Tap "I'll get this" on as many things as you like.</p></div></li>
                <li><span>2</span><div><strong>Choose a day</strong><p>Tap Continue, then tell us your name, phone, email and the day you would like to send them.</p></div></li>
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

    <footer class="footer">
        <p>Made with love for <?= e($site['baby_name']) ?> · <?= e($site['parents']) ?></p>
        <a href="#welcome" class="link-btn">🎈 Back to the balloon</a>
    </footer>

    <!-- The gifts this guest has chosen so far (appears after the first "I'll get this"). -->
    <div class="gift-bar" id="gift-bar" hidden>
        <div class="gift-bar-inner">
            <div class="gift-bar-text">
                <strong id="gift-bar-count">You're giving 1 gift</strong>
                <span id="gift-bar-names"></span>
            </div>
            <button type="button" class="btn btn-accent" id="gift-bar-go">Continue</button>
        </div>
    </div>
</div>

<!-- ===================================================================== -->
<!-- Gift form (bottom sheet)                                              -->
<!-- ===================================================================== -->
<dialog class="sheet" id="pledge-modal" aria-labelledby="modal-title">
    <form class="sheet-card" id="pledge-form" method="post" action="api/pledge.php" novalidate>
        <span class="sheet-grip" aria-hidden="true"></span>
        <button type="button" class="sheet-close" data-close aria-label="Close">×</button>

        <div data-step="form">
            <p class="kicker">Your gifts for <?= e($site['baby_name']) ?></p>
            <h2 class="sheet-title" id="modal-title">Thank you for your kindness 💛</h2>
            <ul class="chosen-list" id="chosen-list"></ul>
            <button type="button" class="link-btn add-more" data-close>+ Add more gifts</button>

            <input type="hidden" name="token" value="<?= e($token) ?>">
            <div class="hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>

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
                <label for="f-date" id="f-date-label">When will you send them?</label>
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
            <button type="submit" class="btn btn-accent btn-block" id="submit-btn">Confirm my gifts</button>
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
