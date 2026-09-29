<?php
/**
 * Site footer + closing tags.
 * Expects: $config (array). Optional: $isHome.
 */

$linkPrefix  = ($isHome ?? true) ? '' : '/';
$socialLinks = active_social_links($config);
?>
<footer class="site-footer">
    <div class="container site-footer__inner">
        <p class="site-footer__copy">&copy; <?php echo date('Y'); ?> <?= e($config['person']['name']) ?>. All rights reserved.</p>

        <?php if ($socialLinks): ?>
            <ul class="site-footer__social" aria-label="Social profiles">
                <?php foreach ($socialLinks as $label => $url): ?>
                    <li><a href="<?= e($url) ?>" target="_blank" rel="noopener noreferrer"><?= e($label) ?><span class="visually-hidden"> (opens in a new tab)</span></a></li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>

        <a class="site-footer__top" href="<?= e($linkPrefix) ?>#home">
            Back to top <?= icon('arrow-up') ?>
        </a>
    </div>
</footer>

<a class="back-to-top" href="<?= e($linkPrefix) ?>#home" data-back-to-top aria-label="Back to top">
    <?= icon('arrow-up') ?>
</a>
</body>
</html>
