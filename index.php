<?php
declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';

$skills     = load_data('skills');
$experience = load_data('experience');
$education  = load_data('education');
$projects   = load_data('projects');
$strengths  = load_data('strengths');

$person       = $config['person'];
$socialLinks  = active_social_links($config);
$contactToken = contact_form_token();

// Result of a form submission made without JavaScript (see contact.php).
$flash       = pull_contact_flash();
$old         = $flash['old'] ?? [];
$fieldErrors = $flash['errors'] ?? [];

/** Returns attributes/markup for an individual form field's error state. */
$fieldError = static function (string $field) use ($fieldErrors): string {
    return isset($fieldErrors[$field]) ? (string) $fieldErrors[$field] : '';
};

$isHome = true;
require __DIR__ . '/includes/header.php';
?>

<main id="main">

    <!-- Hero -->
    <section class="hero" id="home" aria-labelledby="hero-title">
        <div class="container hero__inner">
            <div class="hero__content">
                <p class="hero__greeting">Hello, I&rsquo;m</p>
                <h1 class="hero__title" id="hero-title"><?= e($person['name']) ?></h1>
                <p class="hero__headline"><?= e($person['headline']) ?></p>
                <p class="hero__intro">
                    I have hands-on knowledge of HTML, CSS, JavaScript, PHP, WordPress, React and Flutter,
                    and I&rsquo;m looking for an opportunity to apply these skills, solve real problems and keep
                    growing as a developer.
                </p>
                <div class="hero__actions">
                    <a class="button button--primary" href="#skills">View My Skills <?= icon('arrow-right') ?></a>
                    <a class="button button--secondary" href="#contact">Contact Me</a>
                </div>
                <ul class="hero__meta">
                    <li><?= icon('map-pin') ?> <?= e($person['location']) ?></li>
                    <li><?= icon('briefcase') ?> Open to computer-related roles</li>
                </ul>
            </div>

            <div class="hero__visual" aria-hidden="true">
                <div class="code-window">
                    <div class="code-window__bar">
                        <span class="code-window__dot"></span>
                        <span class="code-window__dot"></span>
                        <span class="code-window__dot"></span>
                        <span class="code-window__file">developer.js</span>
                    </div>
<pre class="code-window__body"><code><span class="tok-kw">const</span> developer = {
  name: <span class="tok-str">'Joll Eya Odugbo'</span>,
  focus: <span class="tok-str">'Web &amp; Software'</span>,
  location: <span class="tok-str">'Delta State, NG'</span>,
  skills: [
    <span class="tok-str">'HTML'</span>, <span class="tok-str">'CSS'</span>, <span class="tok-str">'JavaScript'</span>,
    <span class="tok-str">'PHP'</span>, <span class="tok-str">'React'</span>, <span class="tok-str">'Flutter'</span>
  ],
  learning: <span class="tok-bool">true</span>
};

developer.<span class="tok-fn">grow</span>(); <span class="tok-comment">// every day</span></code></pre>
                </div>
            </div>
        </div>
    </section>

    <!-- About -->
    <section class="section" id="about" aria-labelledby="about-title">
        <div class="container about">
            <div class="about__text reveal">
                <p class="eyebrow">About</p>
                <h2 class="section-title" id="about-title">A student building a path in technology</h2>
                <p>
                    I&rsquo;m a 400-level student at the National Open University of Nigeria, studying for a
                    B.Sc. in Criminology and Security Studies. Alongside my degree, I have been developing my
                    skills in web and software technologies.
                </p>
                <p>
                    My work experience includes seven years as a receptionist and supervisor at
                    Jabin Olori Motel in Ughelli, where I was also responsible for CCTV installation, and three
                    years as an accountant at Holy Spirit Catholic Church.
                </p>
                <p>
                    My goal is to obtain a computer-related position where I can apply my technical skills,
                    experience and problem-solving abilities, while continuing to learn, grow professionally and
                    contribute to the organisation I work with.
                </p>
            </div>

            <dl class="info-grid reveal">
                <div class="info-card">
                    <dt><?= icon('map-pin') ?> Location</dt>
                    <dd><?= e($person['location']) ?></dd>
                </div>
                <div class="info-card">
                    <dt><?= icon('graduation') ?> Education</dt>
                    <dd>B.Sc. Criminology &amp; Security Studies</dd>
                </div>
                <div class="info-card">
                    <dt><?= icon('layers') ?> Level</dt>
                    <dd>400 Level</dd>
                </div>
                <div class="info-card">
                    <dt><?= icon('target') ?> Career Focus</dt>
                    <dd>Web &amp; Software Development</dd>
                </div>
            </dl>
        </div>
    </section>

    <!-- Skills -->
    <section class="section section--alt" id="skills" aria-labelledby="skills-title">
        <div class="container">
            <header class="section-header reveal">
                <p class="eyebrow">Skills</p>
                <h2 class="section-title" id="skills-title">Technical skills</h2>
                <p class="section-intro">The technologies and tools I have knowledge of, grouped by area.</p>
            </header>

            <div class="skills-grid">
                <?php foreach ($skills as $group): ?>
                    <article class="card skill-card reveal">
                        <span class="card__icon"><?= icon($group['icon']) ?></span>
                        <h3 class="card__title"><?= e($group['category']) ?></h3>
                        <p class="card__text"><?= e($group['description']) ?></p>
                        <ul class="tag-list" aria-label="<?= e($group['category']) ?> skills">
                            <?php foreach ($group['skills'] as $skill): ?>
                                <li class="tag"><?= e($skill) ?></li>
                            <?php endforeach; ?>
                        </ul>
                    </article>
                <?php endforeach; ?>
            </div>
        </div>
    </section>

    <!-- Experience -->
    <section class="section" id="experience" aria-labelledby="experience-title">
        <div class="container">
            <header class="section-header reveal">
                <p class="eyebrow">Experience</p>
                <h2 class="section-title" id="experience-title">Experience &amp; Service</h2>
                <p class="section-intro">Roles I have held and the organisations I have worked with.</p>
            </header>

            <ol class="timeline">
                <?php foreach ($experience as $item): ?>
                    <li class="timeline__item reveal">
                        <article class="card timeline__card">
                            <div class="timeline__head">
                                <h3 class="card__title"><?= e($item['organization']) ?></h3>
                                <?php if (!empty($item['duration'])): ?>
                                    <p class="label"><?= icon('clock') ?> <?= e($item['duration']) ?></p>
                                <?php endif; ?>
                            </div>
                            <?php if (!empty($item['role']) || !empty($item['period'])): ?>
                                <p class="timeline__role">
                                    <?= e(implode(' · ', array_filter([$item['role'] ?? '', $item['period'] ?? '']))) ?>
                                </p>
                            <?php endif; ?>
                            <?php if (!empty($item['parent'])): ?>
                                <p class="timeline__parent"><?= e($item['parent']) ?></p>
                            <?php endif; ?>
                            <?php if (!empty($item['location'])): ?>
                                <p class="timeline__location"><?= icon('map-pin') ?> <?= e($item['location']) ?></p>
                            <?php endif; ?>
                            <?php if (!empty($item['summary'])): ?>
                                <p class="card__text"><?= e($item['summary']) ?></p>
                            <?php endif; ?>
                            <?php if (!empty($item['responsibilities'])): ?>
                                <div class="timeline__people">
                                    <h4 class="timeline__subhead">Key responsibilities</h4>
                                    <ul class="people-list">
                                        <?php foreach ($item['responsibilities'] as $responsibility): ?>
                                            <li><?= e($responsibility) ?></li>
                                        <?php endforeach; ?>
                                    </ul>
                                </div>
                            <?php endif; ?>
                            <?php if (!empty($item['worked_with'])): ?>
                                <div class="timeline__people">
                                    <h4 class="timeline__subhead">Worked with</h4>
                                    <ul class="people-list">
                                        <?php foreach ($item['worked_with'] as $colleague): ?>
                                            <?php $colleague = is_array($colleague) ? $colleague : ['name' => $colleague]; ?>
                                            <li>
                                                <span>
                                                    <?= e($colleague['name'] ?? '') ?>
                                                    <?php if (!empty($colleague['role'])): ?>
                                                        <span class="people-list__role"><?= e($colleague['role']) ?></span>
                                                    <?php endif; ?>
                                                </span>
                                            </li>
                                        <?php endforeach; ?>
                                    </ul>
                                </div>
                            <?php endif; ?>
                        </article>
                    </li>
                <?php endforeach; ?>
            </ol>
        </div>
    </section>

    <!-- Education -->
    <section class="section section--alt" id="education" aria-labelledby="education-title">
        <div class="container">
            <header class="section-header reveal">
                <p class="eyebrow">Education</p>
                <h2 class="section-title" id="education-title">Academic background</h2>
            </header>

            <div class="education-grid">
                <?php foreach ($education as $item): ?>
                    <article class="card education-card reveal">
                        <span class="card__icon"><?= icon('graduation') ?></span>
                        <div>
                            <h3 class="card__title"><?= e($item['institution']) ?></h3>
                            <p class="education-card__award"><?= e($item['award']) ?></p>
                            <ul class="education-card__meta">
                                <?php if (!empty($item['status'])): ?>
                                    <li class="label label--accent"><?= e($item['status']) ?></li>
                                <?php endif; ?>
                                <?php foreach ($item['details'] ?? [] as $detail): ?>
                                    <li class="label"><?= e($detail) ?></li>
                                <?php endforeach; ?>
                            </ul>
                        </div>
                    </article>
                <?php endforeach; ?>
            </div>
        </div>
    </section>

    <!-- Projects -->
    <section class="section" id="projects" aria-labelledby="projects-title">
        <div class="container">
            <header class="section-header reveal">
                <p class="eyebrow">Projects</p>
                <h2 class="section-title" id="projects-title">Projects</h2>
                <?php if ($projects): ?>
                    <p class="section-intro">A selection of things I have built.</p>
                <?php endif; ?>
            </header>

            <?php if ($projects): ?>
                <div class="projects-grid">
                    <?php foreach ($projects as $project): ?>
                        <article class="card project-card reveal">
                            <?php if (!empty($project['image'])): ?>
                                <picture class="project-card__media">
                                    <?php if (!empty($project['image_webp'])): ?>
                                        <source srcset="<?= e('/' . ltrim($project['image_webp'], '/')) ?>" type="image/webp">
                                    <?php endif; ?>
                                    <img src="<?= e('/' . ltrim($project['image'], '/')) ?>"
                                         alt="<?= e($project['image_alt'] ?? ('Screenshot of ' . ($project['title'] ?? 'project'))) ?>"
                                         width="1200" height="750" loading="lazy" decoding="async">
                                </picture>
                            <?php endif; ?>
                            <div class="project-card__body">
                                <?php if (!empty($project['category'])): ?>
                                    <p class="project-card__category"><?= e($project['category']) ?></p>
                                <?php endif; ?>
                                <h3 class="card__title"><?= e($project['title'] ?? 'Untitled project') ?></h3>
                                <?php if (!empty($project['description'])): ?>
                                    <p class="card__text"><?= e($project['description']) ?></p>
                                <?php endif; ?>
                                <?php if (!empty($project['technologies'])): ?>
                                    <ul class="tag-list" aria-label="Technologies used">
                                        <?php foreach ($project['technologies'] as $tech): ?>
                                            <li class="tag"><?= e($tech) ?></li>
                                        <?php endforeach; ?>
                                    </ul>
                                <?php endif; ?>
                                <?php
                                $liveUrl   = (string) ($project['live_url'] ?? '');
                                $githubUrl = (string) ($project['github_url'] ?? '');
                                $hasLive   = (bool) preg_match('#^https?://#i', $liveUrl);
                                $hasGithub = (bool) preg_match('#^https?://#i', $githubUrl);
                                ?>
                                <?php if ($hasLive || $hasGithub): ?>
                                    <div class="project-card__links">
                                        <?php if ($hasLive): ?>
                                            <a class="button button--primary button--small" href="<?= e($liveUrl) ?>" target="_blank" rel="noopener noreferrer">
                                                <?= icon('external') ?> Live Site<span class="visually-hidden">: <?= e($project['title'] ?? '') ?> (opens in a new tab)</span>
                                            </a>
                                        <?php endif; ?>
                                        <?php if ($hasGithub): ?>
                                            <a class="button button--secondary button--small" href="<?= e($githubUrl) ?>" target="_blank" rel="noopener noreferrer">
                                                <?= icon('code') ?> Source Code<span class="visually-hidden">: <?= e($project['title'] ?? '') ?> (opens in a new tab)</span>
                                            </a>
                                        <?php endif; ?>
                                    </div>
                                <?php endif; ?>
                            </div>
                        </article>
                    <?php endforeach; ?>
                </div>
            <?php else: ?>
                <div class="empty-state reveal">
                    <span class="empty-state__icon"><?= icon('folder') ?></span>
                    <h3 class="empty-state__title">Development projects will be added here soon.</h3>
                    <p class="empty-state__text">
                        I&rsquo;m preparing my projects for publication. In the meantime, feel free to get in touch.
                    </p>
                    <a class="button button--secondary button--small" href="#contact">Contact Me</a>
                </div>
            <?php endif; ?>
        </div>
    </section>

    <!-- Personal strengths -->
    <section class="section section--alt" id="strengths" aria-labelledby="strengths-title">
        <div class="container">
            <header class="section-header reveal">
                <p class="eyebrow">Strengths</p>
                <h2 class="section-title" id="strengths-title">Personal strengths</h2>
                <p class="section-intro">Qualities I bring to any team or role.</p>
            </header>

            <ul class="strengths-grid">
                <?php foreach ($strengths as $strength): ?>
                    <li class="card strength-card reveal">
                        <span class="card__icon"><?= icon($strength['icon']) ?></span>
                        <h3 class="card__title"><?= e($strength['title']) ?></h3>
                        <p class="card__text"><?= e($strength['description']) ?></p>
                    </li>
                <?php endforeach; ?>
            </ul>
        </div>
    </section>

    <!-- Contact -->
    <section class="section section--dark" id="contact" aria-labelledby="contact-title">
        <div class="container contact">
            <div class="contact__info reveal">
                <p class="eyebrow">Contact</p>
                <h2 class="section-title" id="contact-title">Get in touch</h2>
                <p class="section-intro">
                    I&rsquo;m open to computer-related roles, internships and junior developer opportunities.
                    Send a message and I&rsquo;ll reply as soon as I can.
                </p>

                <ul class="contact-list">
                    <li>
                        <span class="contact-list__icon"><?= icon('mail') ?></span>
                        <span>
                            <span class="contact-list__label">Email</span>
                            <a href="mailto:<?= e($person['email']) ?>"><?= e($person['email']) ?></a>
                        </span>
                    </li>
                    <li>
                        <span class="contact-list__icon"><?= icon('phone') ?></span>
                        <span>
                            <span class="contact-list__label">Phone</span>
                            <a href="tel:<?= e($person['phone_intl']) ?>"><?= e($person['phone']) ?></a>
                        </span>
                    </li>
                    <li>
                        <span class="contact-list__icon"><?= icon('map-pin') ?></span>
                        <span>
                            <span class="contact-list__label">Location</span>
                            <?= e($person['location']) ?>
                        </span>
                    </li>
                </ul>

                <?php if ($socialLinks): ?>
                    <ul class="social-list" aria-label="Social profiles">
                        <?php foreach ($socialLinks as $label => $url): ?>
                            <li>
                                <a href="<?= e($url) ?>" target="_blank" rel="noopener noreferrer">
                                    <?= icon('link') ?> <?= e($label) ?><span class="visually-hidden"> (opens in a new tab)</span>
                                </a>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                <?php endif; ?>
            </div>

            <div class="contact__form-wrap reveal">
                <form class="contact-form" action="/contact.php" method="post" novalidate data-contact-form
                      data-fallback-email="<?= e($person['email']) ?>">
                    <input type="hidden" name="token" value="<?= e($contactToken) ?>">

                    <!-- Honeypot: hidden from people, filled in by spam bots. -->
                    <div class="contact-form__hp" aria-hidden="true">
                        <label for="website">Leave this field empty</label>
                        <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
                    </div>

                    <div class="form-row form-row--split">
                        <div class="form-field<?= $fieldError('name') ? ' has-error' : '' ?>">
                            <label for="contact-name">Full Name</label>
                            <input type="text" id="contact-name" name="name" autocomplete="name" required
                                   minlength="2" maxlength="100" value="<?= e($old['name'] ?? '') ?>"
                                   aria-describedby="contact-name-error"<?= $fieldError('name') ? ' aria-invalid="true"' : '' ?>>
                            <p class="form-field__error" id="contact-name-error" data-error-for="name"><?= e($fieldError('name')) ?></p>
                        </div>
                        <div class="form-field<?= $fieldError('email') ? ' has-error' : '' ?>">
                            <label for="contact-email">Email Address</label>
                            <input type="email" id="contact-email" name="email" autocomplete="email" required
                                   maxlength="254" value="<?= e($old['email'] ?? '') ?>"
                                   aria-describedby="contact-email-error"<?= $fieldError('email') ? ' aria-invalid="true"' : '' ?>>
                            <p class="form-field__error" id="contact-email-error" data-error-for="email"><?= e($fieldError('email')) ?></p>
                        </div>
                    </div>

                    <div class="form-field<?= $fieldError('subject') ? ' has-error' : '' ?>">
                        <label for="contact-subject">Subject</label>
                        <input type="text" id="contact-subject" name="subject" required
                               minlength="3" maxlength="150" value="<?= e($old['subject'] ?? '') ?>"
                               aria-describedby="contact-subject-error"<?= $fieldError('subject') ? ' aria-invalid="true"' : '' ?>>
                        <p class="form-field__error" id="contact-subject-error" data-error-for="subject"><?= e($fieldError('subject')) ?></p>
                    </div>

                    <div class="form-field<?= $fieldError('message') ? ' has-error' : '' ?>">
                        <label for="contact-message">Message</label>
                        <textarea id="contact-message" name="message" rows="6" required
                                  minlength="10" maxlength="<?= (int) $config['contact']['max_message_length'] ?>"
                                  aria-describedby="contact-message-error"<?= $fieldError('message') ? ' aria-invalid="true"' : '' ?>><?= e($old['message'] ?? '') ?></textarea>
                        <p class="form-field__error" id="contact-message-error" data-error-for="message"><?= e($fieldError('message')) ?></p>
                    </div>

                    <div class="contact-form__footer">
                        <button class="button button--primary" type="submit" data-submit>
                            <span data-submit-label>Send Message</span> <?= icon('send') ?>
                        </button>
                        <p class="form-status<?= $flash ? ' form-status--' . e($flash['status']) : '' ?>"
                           role="status" aria-live="polite" data-form-status><?= e($flash['message'] ?? '') ?></p>
                    </div>
                </form>
            </div>
        </div>
    </section>

</main>

<?php require __DIR__ . '/includes/footer.php'; ?>
