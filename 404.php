<?php
declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';

http_response_code(404);

$isHome          = false;
$pageTitle       = 'Page not found | ' . $config['site']['name'];
$pageDescription = 'The page you were looking for could not be found.';
$robots          = 'noindex, follow';

require __DIR__ . '/includes/header.php';
?>

<main id="main">
    <section class="section" aria-labelledby="not-found-title">
        <div class="container">
            <div class="empty-state">
                <span class="empty-state__icon"><?= icon('search') ?></span>
                <p class="eyebrow">Error 404</p>
                <h1 class="empty-state__title" id="not-found-title">This page could not be found.</h1>
                <p class="empty-state__text">The link may be broken or the page may have moved.</p>
                <a class="button button--primary button--small" href="/">Back to home <?= icon('arrow-right') ?></a>
            </div>
        </div>
    </section>
</main>

<?php require __DIR__ . '/includes/footer.php'; ?>
