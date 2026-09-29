<?php
/**
 * Document head + site header.
 *
 * Expects: $config (array). Optional: $pageTitle, $pageDescription, $isHome, $robots.
 */

$isHome          = $isHome ?? true;
$pageTitle       = $pageTitle ?? $config['site']['title'];
$pageDescription = $pageDescription ?? $config['site']['description'];
$robots          = $robots ?? 'index, follow';
$baseUrl         = site_url($config);
$canonicalUrl    = $baseUrl . '/';
$ogImage         = $baseUrl . $config['site']['og_image'];
$linkPrefix      = $isHome ? '' : '/';

$navItems = [
    'home'       => 'Home',
    'about'      => 'About',
    'skills'     => 'Skills',
    'experience' => 'Experience',
    'education'  => 'Education',
    'projects'   => 'Projects',
    'contact'    => 'Contact',
];

$person = $config['person'];
$schema = [
    '@context'    => 'https://schema.org',
    '@type'       => 'Person',
    'name'        => $person['name'],
    'url'         => $canonicalUrl,
    'email'       => 'mailto:' . $person['email'],
    'telephone'   => $person['phone_intl'],
    'description' => $config['site']['description'],
    'address'     => [
        '@type'           => 'PostalAddress',
        'addressRegion'   => $person['region'],
        'addressCountry'  => $person['country'],
    ],
    'knowsAbout'  => ['HTML', 'CSS', 'JavaScript', 'PHP', 'WordPress', 'React', 'Flutter'],
];
$socialUrls = array_values(active_social_links($config));
if ($socialUrls) {
    $schema['sameAs'] = $socialUrls;
}
?>
<!DOCTYPE html>
<html lang="<?= e($config['site']['lang']) ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($pageTitle) ?></title>
    <meta name="description" content="<?= e($pageDescription) ?>">
    <meta name="robots" content="<?= e($robots) ?>">
    <meta name="author" content="<?= e($person['name']) ?>">
    <link rel="canonical" href="<?= e($canonicalUrl) ?>">

    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="#F7F8FA" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#0D1117" media="(prefers-color-scheme: dark)">

    <meta property="og:type" content="website">
    <meta property="og:site_name" content="<?= e($config['site']['name']) ?>">
    <meta property="og:title" content="<?= e($pageTitle) ?>">
    <meta property="og:description" content="<?= e($pageDescription) ?>">
    <meta property="og:url" content="<?= e($canonicalUrl) ?>">
    <meta property="og:image" content="<?= e($ogImage) ?>">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="<?= e($person['name'] . ' – ' . $person['headline']) ?>">
    <meta property="og:locale" content="<?= e($config['site']['locale']) ?>">
    <meta name="twitter:card" content="summary_large_image">

    <link rel="icon" href="/assets/images/icons/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="/assets/images/icons/favicon-32.png" sizes="32x32" type="image/png">
    <link rel="apple-touch-icon" href="/assets/images/icons/apple-touch-icon.png">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
    <link rel="stylesheet" href="<?= e(asset('assets/css/style.css')) ?>">

    <!-- Applies the saved/system colour theme before the page paints to avoid a flash. -->
    <script>
        (function () {
            var root = document.documentElement, theme = null;
            root.classList.add('js');
            try { theme = localStorage.getItem('theme'); } catch (err) {}
            if (theme !== 'light' && theme !== 'dark') {
                theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
            root.setAttribute('data-theme', theme);
        })();
    </script>
    <script src="<?= e(asset('assets/js/main.js')) ?>" defer></script>

    <script type="application/ld+json"><?= json_encode($schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
</head>
<body>
<?php require __DIR__ . '/icons.php'; ?>
<a class="skip-link" href="#main">Skip to main content</a>

<header class="site-header" id="site-header">
    <div class="container site-header__inner">
        <a class="brand" href="<?= e($linkPrefix) ?>#home" aria-label="<?= e($person['name']) ?>, back to top">
            <span class="brand__mark" aria-hidden="true">JEO.</span>
            <span class="brand__name"><?= e($person['name']) ?></span>
        </a>

        <button class="icon-button nav-toggle" type="button" aria-controls="primary-nav" aria-expanded="false" data-nav-toggle>
            <span class="visually-hidden" data-nav-toggle-label>Open menu</span>
            <?= icon('menu', 'icon nav-toggle__open') ?>
            <?= icon('close', 'icon nav-toggle__close') ?>
        </button>

        <nav class="primary-nav" id="primary-nav" aria-label="Main navigation" data-nav>
            <ul class="primary-nav__list">
                <?php foreach ($navItems as $id => $label): ?>
                    <li><a class="primary-nav__link" href="<?= e($linkPrefix . '#' . $id) ?>" data-nav-link><?= e($label) ?></a></li>
                <?php endforeach; ?>
            </ul>
            <a class="button button--primary button--small primary-nav__cta" href="<?= e($linkPrefix) ?>#contact">Contact Me</a>
        </nav>

        <button class="icon-button theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme">
            <?= icon('moon', 'icon theme-toggle__moon') ?>
            <?= icon('sun', 'icon theme-toggle__sun') ?>
        </button>
    </div>
</header>
