/**
 * Joll Eya Odugbo – Portfolio
 * Small, dependency-free enhancements. The site works without this file;
 * JavaScript only adds theme switching, the mobile menu, scroll effects
 * and an in-page contact form submission.
 */
(function () {
    'use strict';

    const root = document.documentElement;
    const desktopQuery = window.matchMedia('(min-width: 1024px)');

    /* Theme (light / dark)
       ---------------------------------------------------------------------- */
    function initTheme() {
        const toggle = document.querySelector('[data-theme-toggle]');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
        const themeMetas = document.querySelectorAll('meta[name="theme-color"]');

        const storedTheme = () => {
            try {
                return localStorage.getItem('theme');
            } catch (error) {
                return null;
            }
        };

        const applyTheme = (theme) => {
            root.setAttribute('data-theme', theme);
            themeMetas.forEach((meta) => meta.setAttribute('content', theme === 'dark' ? '#0D1117' : '#F7F8FA'));
            if (toggle) {
                toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
            }
        };

        applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

        if (toggle) {
            toggle.addEventListener('click', () => {
                const nextTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                applyTheme(nextTheme);
                try {
                    localStorage.setItem('theme', nextTheme);
                } catch (error) {
                    /* Storage unavailable (e.g. private mode): theme still changes for this visit. */
                }
            });
        }

        // Follow the operating system setting until the visitor makes a choice.
        const onSystemChange = (event) => {
            const saved = storedTheme();
            if (saved !== 'light' && saved !== 'dark') {
                applyTheme(event.matches ? 'dark' : 'light');
            }
        };
        if (systemDark.addEventListener) {
            systemDark.addEventListener('change', onSystemChange);
        } else if (systemDark.addListener) {
            systemDark.addListener(onSystemChange);
        }
    }

    /* Mobile navigation
       ---------------------------------------------------------------------- */
    function initNavigation() {
        const toggle = document.querySelector('[data-nav-toggle]');
        const nav = document.querySelector('[data-nav]');
        const label = document.querySelector('[data-nav-toggle-label]');
        const header = document.getElementById('site-header');
        if (!toggle || !nav) {
            return;
        }

        const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

        const setOpen = (open, returnFocus) => {
            toggle.setAttribute('aria-expanded', String(open));
            nav.classList.toggle('is-open', open);
            if (label) {
                label.textContent = open ? 'Close menu' : 'Open menu';
            }
            if (!open && returnFocus) {
                toggle.focus();
            }
        };

        toggle.addEventListener('click', () => setOpen(!isOpen()));

        nav.addEventListener('click', (event) => {
            if (event.target.closest('a') && !desktopQuery.matches) {
                setOpen(false);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && isOpen()) {
                setOpen(false, true);
            }
        });

        document.addEventListener('click', (event) => {
            if (isOpen() && header && !header.contains(event.target)) {
                setOpen(false);
            }
        });

        const onBreakpointChange = (event) => {
            if (event.matches) {
                setOpen(false);
            }
        };
        if (desktopQuery.addEventListener) {
            desktopQuery.addEventListener('change', onBreakpointChange);
        } else if (desktopQuery.addListener) {
            desktopQuery.addListener(onBreakpointChange);
        }
    }

    /* Header shadow + back-to-top button on scroll
       ---------------------------------------------------------------------- */
    function initScrollState() {
        const header = document.getElementById('site-header');
        const backToTop = document.querySelector('[data-back-to-top]');
        let ticking = false;

        const update = () => {
            const y = window.scrollY || window.pageYOffset;
            if (header) {
                header.classList.toggle('is-scrolled', y > 8);
            }
            if (backToTop) {
                backToTop.classList.toggle('is-visible', y > 600);
            }
            ticking = false;
        };

        window.addEventListener('scroll', () => {
            if (!ticking) {
                ticking = true;
                window.requestAnimationFrame(update);
            }
        }, { passive: true });

        update();
    }

    /* Highlight the navigation link for the section in view
       ---------------------------------------------------------------------- */
    function initActiveSection() {
        const links = Array.from(document.querySelectorAll('[data-nav-link]'));
        if (!links.length || !('IntersectionObserver' in window)) {
            return;
        }

        const linkById = new Map();
        links.forEach((link) => {
            const id = (link.getAttribute('href') || '').split('#')[1];
            const section = id && document.getElementById(id);
            if (section) {
                linkById.set(id, link);
            }
        });

        const setActive = (id) => {
            links.forEach((link) => {
                const active = linkById.get(id) === link;
                link.classList.toggle('is-active', active);
                if (active) {
                    link.setAttribute('aria-current', 'true');
                } else {
                    link.removeAttribute('aria-current');
                }
            });
        };

        // A thin band across the middle of the viewport decides which section is "current".
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    setActive(entry.target.id);
                }
            });
        }, { rootMargin: '-45% 0px -50% 0px' });

        linkById.forEach((link, id) => observer.observe(document.getElementById(id)));

        // The last section may never reach the middle of the screen on tall displays.
        window.addEventListener('scroll', () => {
            const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
            if (atBottom) {
                setActive('contact');
            }
        }, { passive: true });
    }

    /* Reveal-on-scroll
       ---------------------------------------------------------------------- */
    function initReveal() {
        const items = document.querySelectorAll('.reveal');
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reducedMotion || !('IntersectionObserver' in window)) {
            items.forEach((item) => item.classList.add('is-visible'));
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -40px 0px', threshold: 0.1 });

        items.forEach((item) => observer.observe(item));
    }

    /* Contact form (submits in the background; falls back to a normal post)
       ---------------------------------------------------------------------- */
    function initContactForm() {
        const form = document.querySelector('[data-contact-form]');
        if (!form || !window.fetch || !window.FormData) {
            return;
        }

        const status = form.querySelector('[data-form-status]');
        const submit = form.querySelector('[data-submit]');
        const submitLabel = form.querySelector('[data-submit-label]');
        const fields = ['name', 'email', 'subject', 'message'];
        const fallbackEmail = form.getAttribute('data-fallback-email') || '';
        const fallbackMessage = 'Sorry, something went wrong. Please try again later'
            + (fallbackEmail ? ', or email ' + fallbackEmail + ' directly.' : '.');

        const validators = {
            name: (value) => (value.length < 2 ? 'Please enter your full name.' : ''),
            email: (value) => {
                if (!value) {
                    return 'Please enter your email address.';
                }
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Please enter a valid email address.';
            },
            subject: (value) => (value.length < 3 ? 'Please enter a subject (at least 3 characters).' : ''),
            message: (value) => (value.length < 10 ? 'Please enter a message of at least 10 characters.' : ''),
        };

        const setFieldError = (name, message) => {
            const input = form.elements[name];
            const error = form.querySelector('[data-error-for="' + name + '"]');
            const wrapper = input ? input.closest('.form-field') : null;
            if (!input) {
                return;
            }
            if (message) {
                input.setAttribute('aria-invalid', 'true');
            } else {
                input.removeAttribute('aria-invalid');
            }
            if (wrapper) {
                wrapper.classList.toggle('has-error', Boolean(message));
            }
            if (error) {
                error.textContent = message || '';
            }
        };

        const setStatus = (type, message) => {
            status.classList.remove('form-status--success', 'form-status--error');
            if (type) {
                status.classList.add('form-status--' + type);
            }
            status.textContent = message;
        };

        const setBusy = (busy) => {
            submit.disabled = busy;
            submit.setAttribute('aria-busy', String(busy));
            if (submitLabel) {
                submitLabel.textContent = busy ? 'Sending…' : 'Send Message';
            }
        };

        const validateField = (name) => {
            const input = form.elements[name];
            const message = validators[name](input.value.trim());
            setFieldError(name, message);
            return message;
        };

        // Re-check a field once the visitor has left it, and clear errors while typing.
        fields.forEach((name) => {
            const input = form.elements[name];
            input.addEventListener('blur', () => {
                if (input.value.trim() !== '' || input.getAttribute('aria-invalid') === 'true') {
                    validateField(name);
                }
            });
            input.addEventListener('input', () => {
                if (input.getAttribute('aria-invalid') === 'true') {
                    validateField(name);
                }
            });
        });

        form.addEventListener('submit', (event) => {
            event.preventDefault();

            const invalid = fields.filter((name) => validateField(name) !== '');
            if (invalid.length) {
                setStatus('error', 'Please correct the highlighted fields.');
                form.elements[invalid[0]].focus();
                return;
            }

            setBusy(true);
            setStatus('', 'Sending your message…');

            fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
            })
                .then((response) => response.json().catch(() => ({ success: false, message: fallbackMessage })))
                .then((data) => {
                    if (data.success) {
                        form.reset();
                        fields.forEach((name) => setFieldError(name, ''));
                        setStatus('success', data.message);
                        return;
                    }
                    const errors = data.errors || {};
                    fields.forEach((name) => setFieldError(name, errors[name] || ''));
                    setStatus('error', data.message || fallbackMessage);
                    const firstInvalid = fields.find((name) => errors[name]);
                    if (firstInvalid) {
                        form.elements[firstInvalid].focus();
                    }
                })
                .catch(() => setStatus('error', fallbackMessage))
                .finally(() => setBusy(false));
        });
    }

    initTheme();
    initNavigation();
    initScrollState();
    initActiveSection();
    initReveal();
    initContactForm();
})();
