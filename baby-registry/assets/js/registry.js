/* Baby Registry – public page behaviour.
 *
 * The page is a sequence of screens, switched with the address hash so the
 * phone's back button works:
 *   #welcome → #guess → #pop → #result → #registry
 */
(function () {
    'use strict';

    var data = window.REGISTRY || { items: [], config: {}, reveal: {}, tally: {} };
    var cfg = data.config;
    var reveal = data.reveal || { revealed: false, gender: null };
    var tally = data.tally || { boy: 0, girl: 0, total: 0 };
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var itemsById = {};
    data.items.forEach(function (item) { itemsById[item.id] = item; });

    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

    /* =====================================================================
     * Helpers
     * =================================================================== */

    function toast(text) {
        var el = document.createElement('div');
        el.className = 'toast';
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 2200);
    }

    function vibrate(pattern) {
        if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* not supported */ } }
    }

    /* Page colours: 'neutral' (deep black), 'boy' (baby blue) or 'girl' (baby pink). */
    var THEME_BAR = { neutral: '#0a0909', boy: '#cfe5fa', girl: '#f8d7e3' };
    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) { meta.setAttribute('content', THEME_BAR[theme] || THEME_BAR.neutral); }
    }

    function store(key, value) {
        try {
            if (value === undefined) { return JSON.parse(localStorage.getItem(key) || 'null'); }
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { return null; }
        return null;
    }

    function daysUntil(iso) {
        if (!iso) { return null; }
        var target = new Date(iso + 'T00:00:00');
        var now = new Date();
        now.setHours(0, 0, 0, 0);
        return Math.round((target - now) / 86400000);
    }

    function isoDate(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function post(url, formData) {
        return fetch(url, { method: 'POST', body: formData, credentials: 'same-origin' })
            .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Unexpected server response.' }; }); });
    }

    function guessLabel(g) { return g === 'boy' ? 'Boy 💙' : 'Girl 💗'; }

    /* A short "pop" made with the Web Audio API (no sound file needed). */
    var audioCtx = null;
    function popSound() {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            var len = Math.floor(audioCtx.sampleRate * 0.18);
            var buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
            var ch = buffer.getChannelData(0);
            for (var i = 0; i < len; i++) { ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4); }
            var src = audioCtx.createBufferSource();
            var filter = audioCtx.createBiquadFilter();
            var gain = audioCtx.createGain();
            filter.type = 'lowpass';
            filter.frequency.value = 2200;
            gain.gain.value = 0.9;
            src.buffer = buffer;
            src.connect(filter).connect(gain).connect(audioCtx.destination);
            src.start();
        } catch (e) { /* audio not available */ }
    }

    /* =====================================================================
     * Confetti (tiny canvas implementation, no library)
     * =================================================================== */

    var canvas = $('#confetti');
    var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    var particles = [];
    var running = false;

    function confetti(colors, originX, originY, count) {
        if (!ctx || reducedMotion) { return; }
        var dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        count = count || 180;
        for (var i = 0; i < count; i++) {
            var angle = Math.random() * Math.PI * 2;
            var speed = 4 + Math.random() * 9;
            particles.push({
                x: originX, y: originY,
                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 6,
                w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
                r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
                color: colors[i % colors.length], life: 0
            });
        }
        if (!running) { running = true; requestAnimationFrame(frame); }
    }

    function frame() {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        particles = particles.filter(function (p) {
            p.life++;
            p.vy += 0.25;
            p.vx *= 0.985;
            p.x += p.vx;
            p.y += p.vy;
            p.r += p.vr;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.r);
            ctx.globalAlpha = Math.max(0, 1 - p.life / 220);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
            ctx.restore();
            return p.y < window.innerHeight + 40 && p.life < 220;
        });
        if (particles.length) { requestAnimationFrame(frame); } else { running = false; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
    }

    var PALETTE = {
        boy: ['#6aa6e8', '#a8cdf5', '#ffffff', '#3f7fc6'],
        girl: ['#e0699a', '#f4a3c3', '#ffffff', '#c94b7f'],
        neutral: ['#6aa6e8', '#e0699a', '#d9b779', '#ffffff']
    };

    /* =====================================================================
     * Visitor state
     * =================================================================== */

    var STATE_KEY = 'registry_state';
    var saved = store(STATE_KEY) || {};
    var state = {
        guess: data.myGuess || saved.guess || null,   // 'boy' | 'girl'
        locked: !!data.myGuess,                        // guess saved on the server
        notify: !!saved.notify,                        // left contact details for the reveal
        popped: saved.popped || null                   // 'secret' | 'boy' | 'girl': what the balloon showed
    };
    function persist() { store(STATE_KEY, { guess: state.guess, notify: state.notify, popped: state.popped }); }
    function poppedCurrent() { return state.popped === (reveal.revealed ? reveal.gender : 'secret'); }

    /* The welcome screen is always black. Everywhere else the page takes the
     * colour of the guest's guess, or of the real answer once they have popped
     * the balloon after the reveal. */
    function themeFor(screen) {
        if (screen === 'welcome') { return 'neutral'; }
        if (screen !== 'guess' && reveal.revealed && poppedCurrent()) { return reveal.gender; }
        return state.guess || 'neutral';
    }

    /* =====================================================================
     * Screens
     * =================================================================== */

    var SCREENS = ['welcome', 'guess', 'pop', 'result', 'registry'];
    var REGISTRY_ANCHORS = /^(cat-|reg|wishes|bank)/;

    function go(name, replace) {
        if (replace) { history.replaceState(null, '', '#' + name); route(); } else { location.hash = name; }
    }

    function showScreen(name) {
        SCREENS.forEach(function (s) { document.getElementById(s).hidden = s !== name; });
        setTheme(themeFor(name));
        if (screenInit[name]) { screenInit[name](); }
    }

    function route() {
        var hash = decodeURIComponent(location.hash.slice(1));

        if (REGISTRY_ANCHORS.test(hash)) {
            if ($('#registry').hidden) {
                showScreen('registry');
                var target = document.getElementById(hash);
                if (target) { setTimeout(function () { target.scrollIntoView(); }, 0); }
            }
            return;
        }
        if (SCREENS.indexOf(hash) === -1) { hash = 'welcome'; }

        // Guards, so a screen is never shown out of order.
        if (hash === 'guess' && state.locked && !reveal.revealed) { return go('pop', true); }
        if (hash === 'pop' && !state.guess) { return go('guess', true); }
        if (hash === 'result' && !poppedCurrent()) { return go(state.guess ? 'pop' : 'welcome', true); }

        showScreen(hash);
        window.scrollTo(0, 0);
    }

    var screenInit = {
        welcome: function () {
            var q = $('#welcome-q');
            var cta = $('#welcome-cta');
            var skip = $('#welcome-skip');
            updateTallyMini();
            skip.textContent = 'Skip to the baby registry';

            if (reveal.revealed && !poppedCurrent()) {
                q.textContent = 'The secret is out! 🎉';
                cta.textContent = state.guess ? 'Pop the balloon to find out 🎈' : 'Take a guess, then find out 🎈';
                cta.href = state.guess ? '#pop' : '#guess';
            } else if (poppedCurrent()) {
                q.textContent = reveal.revealed
                    ? (reveal.gender === 'girl' ? "It's a girl! 💗" : "It's a boy! 💙")
                    : 'You guessed ' + guessLabel(state.guess) + '. The reveal is coming soon!';
                cta.textContent = 'See the baby registry →';
                cta.href = '#registry';
                skip.textContent = reveal.revealed ? 'See the result again' : 'See what everyone guessed';
                skip.href = '#result';
                return;
            } else if (state.guess) {
                q.textContent = 'You guessed ' + guessLabel(state.guess) + '. Ready to pop the balloon?';
                cta.textContent = 'Pop the balloon 🎈';
                cta.href = '#pop';
            } else {
                q.textContent = 'Boy or girl? What do you think?';
                cta.textContent = 'Take a guess 🎈';
                cta.href = '#guess';
            }
            skip.href = '#registry';
        },
        guess: function () {
            $('#notify-box').hidden = reveal.revealed;
            if (state.guess) { pick(state.guess, true); }
        },
        pop: function () {
            balloon.classList.remove('is-popping', 'is-gone');
            $('#shards').innerHTML = '';
            $('#pop-sub').textContent = 'You guessed ' + guessLabel(state.guess) +
                (reveal.revealed ? '. Pop it to see if you were right!' : '. Pop it to see what everyone thinks!');
            setTimeout(function () { balloon.focus({ preventScroll: true }); }, 300);
        },
        result: function () { renderResult(); },
        registry: function () {
            var due = $('[data-due]');
            if (due) {
                var d = daysUntil(due.dataset.due);
                due.textContent = d > 1 ? '👶 Baby arrives in about ' + d + ' days' : (d >= 0 ? '👶 Baby is due any moment!' : '');
            }
        }
    };

    window.addEventListener('hashchange', route);

    function updateTallyMini() {
        var el = $('#tally-mini');
        el.textContent = tally.total > 0
            ? tally.total + (tally.total === 1 ? ' person has' : ' people have') + ' guessed so far'
            : 'Be the first to guess!';
    }

    /* =====================================================================
     * Guess screen
     * =================================================================== */

    var guessForm = $('#guess-form');
    var babyName = $('#g-baby-name');

    function pick(guess, quiet) {
        if (state.locked && guess !== state.guess) { return; }
        state.guess = guess;
        $$('.pick-card').forEach(function (b) {
            b.setAttribute('aria-checked', String(b.dataset.guess === guess));
            b.disabled = state.locked && b.dataset.guess !== guess;
        });
        babyName.placeholder = guess === 'boy' ? 'e.g. Chidi, Daniel, Tobi' : 'e.g. Amara, Zara, Ada';
        setTheme(guess);
        $('[data-error="guess"]').textContent = '';
        if (!quiet) { vibrate(15); }
    }

    $$('.pick-card').forEach(function (btn) {
        btn.addEventListener('click', function () { pick(btn.dataset.guess); });
    });

    guessForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var errorEl = $('#guess-error');
        errorEl.textContent = '';
        $$('[data-error]', guessForm).forEach(function (p) { p.textContent = ''; });

        if (!state.guess) {
            $('[data-error="guess"]').textContent = 'Tap Boy or Girl first.';
            var cards = $('.pick');
            cards.classList.remove('is-shaking');
            void cards.offsetWidth;
            cards.classList.add('is-shaking');
            vibrate(30);
            return;
        }

        // After the reveal, guesses are just for fun and are not saved.
        if (reveal.revealed || state.locked) {
            persist();
            go('pop');
            return;
        }

        var btn = $('#guess-submit');
        btn.classList.add('is-loading');
        var fd = new FormData(guessForm);
        fd.append('guess', state.guess);
        fd.append('token', data.token);

        post('api/guess.php', fd).then(function (res) {
            if (!res.ok) {
                errorEl.textContent = res.error || 'Please try again.';
                Object.keys(res.fields || {}).forEach(function (k) {
                    var p = $('[data-error="' + k + '"]', guessForm);
                    if (p) { p.textContent = res.fields[k]; }
                });
                return;
            }
            state.guess = res.guess;
            state.locked = true;
            state.notify = !!res.notify;
            tally = res.tally || tally;
            persist();
            var msg = guessForm.message.value.trim();
            var name = babyName.value.trim();
            if (msg || name) { addWish(guessForm.name.value.trim(), msg, 'guess', state.guess, name); }
            vibrate([20, 40, 20]);
            go('pop');
        }).catch(function () {
            errorEl.textContent = 'Network error. Please check your connection and try again.';
        }).then(function () { btn.classList.remove('is-loading'); });
    });

    /* =====================================================================
     * Pop screen
     * =================================================================== */

    var balloon = $('#balloon');

    balloon.addEventListener('click', function () {
        if (balloon.classList.contains('is-popping')) { return; }
        var rect = balloon.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height * 0.35;

        popSound();
        vibrate([40, 30, 80]);
        balloon.classList.add('is-popping');

        setTimeout(function () {
            balloon.classList.add('is-gone');
            if (reveal.revealed) { setTheme(reveal.gender); }
            burstShards();
            confetti(PALETTE[reveal.revealed ? reveal.gender : (state.guess || 'neutral')], cx, cy, 220);
            state.popped = reveal.revealed ? reveal.gender : 'secret';
            persist();
            setTimeout(function () { go('result'); }, reducedMotion ? 0 : 900);
        }, reducedMotion ? 0 : 260);
    });

    function burstShards() {
        var box = $('#shards');
        box.innerHTML = '';
        for (var i = 0; i < 14; i++) {
            var s = document.createElement('span');
            s.className = 'shard';
            box.appendChild(s);
            var a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
            var d = 90 + Math.random() * 90;
            (function (el, x, y, rot) {
                requestAnimationFrame(function () {
                    el.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + rot + 'deg) scale(.6)';
                    el.style.opacity = '0';
                });
            }(s, Math.cos(a) * d, Math.sin(a) * d + 40, Math.random() * 360));
        }
    }

    /* =====================================================================
     * Result screen
     * =================================================================== */

    function renderResult() {
        var title = $('#result-title');
        var you = $('#result-you');
        var notify = $('#result-notify');
        var family = cfg.familyName;
        notify.textContent = '';

        if (reveal.revealed) {
            var g = reveal.gender;
            setTheme(g);
            $('#result-kicker').textContent = 'The ' + family + ' are expecting';
            title.textContent = g === 'girl' ? "It's a girl!" : "It's a boy!";
            title.classList.remove('is-secret');
            $('#result-sub').textContent = 'Welcome, Baby ' + (g === 'girl' ? 'Girl' : 'Boy') + ' ' + family;
            you.textContent = state.guess === g
                ? 'You guessed right! 🎉'
                : 'You guessed ' + state.guess + '. So close! 😄';
            $('#tally-total').textContent = tally.total
                ? Math.round((tally[g] || 0) / tally.total * 100) + '% of ' + tally.total + ' guests guessed right'
                : '';
            $('#result-countdown').textContent = cfg.dueDate && daysUntil(cfg.dueDate) > 0
                ? 'Arriving in about ' + daysUntil(cfg.dueDate) + ' days'
                : '';
        } else {
            $('#result-kicker').textContent = 'Your guess is in';
            title.textContent = "It's still a secret 🤫";
            title.classList.add('is-secret');
            $('#result-sub').textContent = 'You guessed ' + guessLabel(state.guess) + '. Here is what everyone thinks:';
            you.textContent = '';
            $('#tally-total').textContent = tally.total + (tally.total === 1 ? ' guess' : ' guesses') + ' so far';
            notify.textContent = state.notify
                ? "🔔 We'll message you the moment it's revealed."
                : '';
            var days = daysUntil(cfg.revealDate);
            $('#result-countdown').textContent = days !== null && days > 0
                ? 'The big reveal is in ' + days + (days === 1 ? ' day' : ' days') + '. Come back to pop the real balloon! 🎈'
                : 'Come back for the big reveal to see if you were right! 🎈';
        }

        $('#tally').hidden = !tally.total;
        ['boy', 'girl'].forEach(function (k) {
            var pct = tally.total ? Math.round((tally[k] || 0) / tally.total * 100) : 0;
            $('[data-pct="' + k + '"]').textContent = pct + '%';
            var bar = $('[data-bar="' + k + '"]');
            bar.style.width = '0';
            setTimeout(function () { bar.style.width = pct + '%'; }, 200);
        });
    }

    $('#replay').addEventListener('click', function () { go('pop'); });

    /* =====================================================================
     * Registry screen
     * =================================================================== */

    var navLinks = $$('#cat-nav a');

    // Highlight the category currently on screen and keep its chip visible.
    if ('IntersectionObserver' in window && navLinks.length) {
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) { return; }
                navLinks.forEach(function (a) {
                    var on = a.dataset.target === entry.target.id;
                    a.classList.toggle('is-active', on);
                    if (on) {
                        var nav = a.parentElement;
                        nav.scrollTo({ left: a.offsetLeft - nav.clientWidth / 2 + a.clientWidth / 2, behavior: reducedMotion ? 'auto' : 'smooth' });
                    }
                });
            });
        }, { rootMargin: '-35% 0px -60% 0px' });
        $$('.cat').forEach(function (c) { spy.observe(c); });
    }

    // Category chips scroll within the registry without changing screens.
    navLinks.forEach(function (a) {
        a.addEventListener('click', function (e) {
            var target = document.getElementById(a.dataset.target);
            if (!target) { return; }
            e.preventDefault();
            target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
        });
    });

    var hideTaken = $('#hide-taken');
    if (hideTaken) {
        hideTaken.addEventListener('change', function () { $('#reg').classList.toggle('hide-done', hideTaken.checked); });
    }

    $$('[data-copy]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var text = btn.dataset.copy;
            var done = function () {
                var old = btn.textContent;
                btn.textContent = 'Copied ✓';
                vibrate(15);
                setTimeout(function () { btn.textContent = old; }, 1600);
            };
            if (navigator.clipboard) { navigator.clipboard.writeText(text).then(done, function () { toast(text); }); } else { toast(text); }
        });
    });

    /* Wishes wall */
    function addWish(name, message, source, guess, suggested) {
        var wall = $('#wall');
        if (!wall || !(message || suggested)) { return; }
        var fig = document.createElement('figure');
        fig.className = 'wish';
        if (message) {
            var q = document.createElement('blockquote');
            q.textContent = message;
            fig.appendChild(q);
        }
        var cap = document.createElement('figcaption');
        cap.textContent = (name || 'A loved one') + ' ';
        var tags = source === 'guess'
            ? [guess === 'boy' ? '💙 guessed boy' : '💗 guessed girl'].concat(suggested ? ['suggests “' + suggested + '”'] : [])
            : ['🎁 picked a gift'];
        tags.forEach(function (t) {
            var tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = t;
            cap.appendChild(tag);
            cap.appendChild(document.createTextNode(' '));
        });
        fig.appendChild(cap);
        wall.insertBefore(fig, wall.firstChild);
        var empty = $('#wall-empty');
        if (empty) { empty.hidden = true; }
    }

    /* =====================================================================
     * Choosing gifts
     * Tapping "I'll get this" adds an item to the guest's list; a bar at the
     * bottom shows how many they have chosen, and "Continue" opens the form.
     * =================================================================== */

    var CHOSEN_KEY = 'registry_chosen';
    var chosen = (store(CHOSEN_KEY) || []).filter(function (id) {
        var it = itemsById[id];
        return it && (it.open || it.remaining > 0);
    });
    var bar = $('#gift-bar');

    function saveChosen() { store(CHOSEN_KEY, chosen); }
    function isChosen(id) { return chosen.indexOf(id) !== -1; }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    function paintRow(id) {
        var row = $('.row[data-id="' + id + '"]');
        if (!row) { return; }
        var btn = $('[data-gift]', row);
        var on = isChosen(id);
        row.classList.toggle('is-chosen', on);
        if (!row.classList.contains('is-done')) {
            btn.setAttribute('aria-pressed', String(on));
            btn.textContent = on ? '💛 Chosen' : "I'll get this";
        }
    }

    function paintBar(bump) {
        var n = chosen.length;
        bar.hidden = n === 0 || $('#registry').hidden;
        $('#gift-bar-count').textContent = "You're giving " + plural(n, 'gift', 'gifts');
        var names = chosen.map(function (id) { return itemsById[id].name; });
        $('#gift-bar-names').textContent = names.length > 2 ? names.slice(0, 2).join(', ') + ' +' + (names.length - 2) + ' more' : names.join(', ');
        if (bump) {
            bar.classList.remove('is-bump');
            void bar.offsetWidth;
            bar.classList.add('is-bump');
        }
    }

    function toggleGift(id, btn) {
        var it = itemsById[id];
        if (!it || (!it.open && it.remaining <= 0)) { return; }
        if (isChosen(id)) {
            chosen.splice(chosen.indexOf(id), 1);
            vibrate(10);
        } else {
            chosen.push(id);
            vibrate(20);
            floatHeart(btn);
        }
        saveChosen();
        paintRow(id);
        paintBar(true);
    }

    /* A little heart that floats from the button down to the bar. */
    function floatHeart(btn) {
        if (reducedMotion || !btn) { return; }
        var from = btn.getBoundingClientRect();
        var heart = document.createElement('span');
        heart.className = 'fly-heart';
        heart.textContent = '💛';
        heart.style.left = (from.left + from.width / 2) + 'px';
        heart.style.top = (from.top + from.height / 2) + 'px';
        document.body.appendChild(heart);
        requestAnimationFrame(function () {
            heart.style.transform = 'translate(' + (window.innerWidth / 2 - from.left - from.width / 2) + 'px,' +
                (window.innerHeight - 60 - from.top - from.height / 2) + 'px) scale(.6)';
            heart.style.opacity = '0';
        });
        setTimeout(function () { heart.remove(); }, 800);
    }

    function markTaken(id) {
        var it = itemsById[id];
        if (it && !it.open) { it.remaining = 0; }
        var i = chosen.indexOf(id);
        if (i !== -1) { chosen.splice(i, 1); }
        var row = $('.row[data-id="' + id + '"]');
        if (row && it && !it.open) {
            row.classList.add('is-done');
            row.classList.remove('is-chosen');
            var btn = $('[data-gift]', row);
            btn.disabled = true;
            btn.textContent = 'Picked';
            btn.setAttribute('aria-pressed', 'false');
        }
    }

    $$('[data-gift]').forEach(function (btn) {
        btn.addEventListener('click', function () { toggleGift(parseInt(btn.dataset.gift, 10), btn); });
    });
    chosen.forEach(paintRow);

    // The bar only belongs on the registry screen.
    var showRegistry = screenInit.registry;
    screenInit.registry = function () { showRegistry(); paintBar(false); };
    window.addEventListener('hashchange', function () { paintBar(false); });

    /* =====================================================================
     * Gift form (bottom sheet)
     * =================================================================== */

    var modal = $('#pledge-modal');
    var form = $('#pledge-form');

    var stepForm = $('[data-step="form"]', form);
    var stepDone = $('[data-step="done"]', form);
    var dateInput = $('#f-date');
    var submitBtn = $('#submit-btn');
    var formError = $('#form-error');

    function showStep(name) {
        stepForm.hidden = name !== 'form';
        stepDone.hidden = name !== 'done';
    }

    function clearErrors() {
        formError.textContent = '';
        $$('.field', form).forEach(function (f) { f.classList.remove('has-error'); });
        $$('[data-error]', form).forEach(function (p) { p.textContent = ''; });
    }

    function showErrors(fields) {
        Object.keys(fields || {}).forEach(function (name) {
            var p = $('[data-error="' + name + '"]', form);
            if (p) {
                p.textContent = fields[name];
                p.closest('.field').classList.add('has-error');
            }
        });
        var first = $('.has-error input, .has-error textarea', form);
        if (first) { first.focus(); }
    }

    function renderChosenList() {
        var list = $('#chosen-list');
        list.innerHTML = '';
        chosen.forEach(function (id) {
            var it = itemsById[id];
            var li = document.createElement('li');
            var label = document.createElement('span');
            label.textContent = it.emoji + '  ' + it.name;
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'chosen-remove';
            remove.setAttribute('aria-label', 'Remove ' + it.name);
            remove.textContent = '×';
            remove.addEventListener('click', function () {
                toggleGift(id);
                if (!chosen.length) { closeModal(); return; }
                renderChosenList();
            });
            li.appendChild(label);
            li.appendChild(remove);
            list.appendChild(li);
        });
        submitBtn.textContent = chosen.length === 1 ? 'Confirm my gift' : 'Confirm my ' + chosen.length + ' gifts';
        $('#f-date-label').textContent = chosen.length === 1 ? 'When will you send it?' : 'When will you send them?';
    }

    /* Quick date choices: Today, Tomorrow, Friday, End of month. */
    /* Quick choices (Today, Tomorrow, Month end) plus "Pick a date", which opens the calendar. */
    var datePick = $('#date-pick');

    function buildDateChips() {
        var box = $('#date-chips');
        $$('[data-date]', box).forEach(function (b) { b.remove(); });
        var base = new Date(cfg.today + 'T00:00:00');
        var tomorrow = new Date(base);
        tomorrow.setDate(tomorrow.getDate() + 1);
        var monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
        if (isoDate(monthEnd) <= isoDate(tomorrow)) { monthEnd = new Date(base.getFullYear(), base.getMonth() + 2, 0); }

        [['Today', base], ['Tomorrow', tomorrow], ['Month end', monthEnd]].forEach(function (opt) {
            var iso = isoDate(opt[1]);
            if (iso > cfg.maxDate) { return; }
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.textContent = opt[0];
            b.dataset.date = iso;
            b.addEventListener('click', function () { dateInput.value = iso; syncDateChips(); vibrate(10); });
            box.insertBefore(b, datePick);
        });
        syncDateChips();
    }

    // Phones open their calendar when the (invisible) date field is tapped; on
    // computers the field needs showPicker() to open its calendar.
    dateInput.addEventListener('click', function () {
        if (typeof dateInput.showPicker === 'function') {
            try { dateInput.showPicker(); } catch (e) { /* the browser opens it itself */ }
        }
    });

    function syncDateChips() {
        var quick = false;
        $$('#date-chips [data-date]').forEach(function (c) {
            var on = c.dataset.date === dateInput.value;
            c.classList.toggle('is-active', on);
            quick = quick || on;
        });
        var picked = !!dateInput.value && !quick;
        datePick.classList.toggle('is-active', picked);
        $('#date-pick-label').textContent = picked
            ? '📅 ' + new Date(dateInput.value + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
            : '📅 Pick a date';
        if (!dateInput.value) { return; }
        $('#date-hint').textContent = daysUntil(dateInput.value) === 0
            ? "You'll get our account details right away in your confirmation."
            : "We'll remind you with our account details on " +
              new Date(dateInput.value + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '.';
    }
    dateInput.addEventListener('change', syncDateChips);

    function openModal() {
        if (!chosen.length) { return; }
        clearErrors();
        showStep('form');
        renderChosenList();
        if (!dateInput.value || dateInput.value < cfg.today) { dateInput.value = cfg.today; }
        buildDateChips();
        if (typeof modal.showModal === 'function') { modal.showModal(); } else { modal.setAttribute('open', ''); }
        vibrate(10);
    }

    function closeModal() {
        if (typeof modal.close === 'function') { modal.close(); } else { modal.removeAttribute('open'); }
        paintBar(false);
    }

    $('#gift-bar-go').addEventListener('click', openModal);
    $$('[data-close]', form).forEach(function (btn) { btn.addEventListener('click', closeModal); });
    modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); } });

    function validate() {
        var errors = {};
        var name = form.full_name.value.trim();
        if (name.length < 3 || name.indexOf(' ') === -1) { errors.full_name = 'Please enter your full name (first and last name).'; }
        if (form.phone.value.replace(/\D/g, '').length < 8) { errors.phone = 'Please enter a valid phone number.'; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim())) { errors.email = 'Please enter a valid email address.'; }
        if (!dateInput.value) { errors.payment_date = 'Please choose the day you will send them.'; }
        return errors;
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        clearErrors();

        var errors = validate();
        if (Object.keys(errors).length) {
            formError.textContent = 'Please check the highlighted fields.';
            showErrors(errors);
            vibrate(30);
            return;
        }

        var label = submitBtn.textContent;
        submitBtn.classList.add('is-loading');
        submitBtn.textContent = 'Saving…';

        var fd = new FormData(form);
        chosen.forEach(function (id) { fd.append('item_ids[]', id); });

        post(form.action, fd).then(function (res) {
            if (!res.ok) {
                // Someone else took one of the gifts meanwhile: drop it from the list.
                (res.gone || []).forEach(markTaken);
                if (res.gone && res.gone.length) {
                    saveChosen();
                    paintBar(false);
                    if (!chosen.length) { closeModal(); toast(res.error); return; }
                    renderChosenList();
                }
                formError.textContent = res.error || 'Something went wrong.';
                showErrors(res.fields);
                return;
            }
            var msg = form.message.value.trim();
            if (msg && form.share_message.checked) { addWish(form.full_name.value.trim(), msg, 'pledge'); }
            (res.items || []).forEach(function (it) {
                if (it.remaining === 0) { markTaken(it.id); }
                var row = $('.row[data-id="' + it.id + '"]');
                if (row) { row.classList.remove('is-chosen', 'is-flash'); void row.offsetWidth; row.classList.add('is-flash'); }
            });
            chosen.forEach(function (id) { var r = $('.row[data-id="' + id + '"]'); if (r) { r.classList.remove('is-chosen'); $('[data-gift]', r).textContent = "I'll get this"; } });
            chosen = [];
            saveChosen();
            showDone(res);
            form.message.value = '';
        }).catch(function () {
            formError.textContent = 'Network error. Please check your connection and try again.';
        }).then(function () {
            submitBtn.classList.remove('is-loading');
            if (submitBtn.textContent === 'Saving…') { submitBtn.textContent = label; }
        });
    });

    function showDone(res) {
        var s = res.summary;
        var firstName = form.full_name.value.trim().split(' ')[0];
        var gifts = s.gifts || [s.gift];
        $('#done-text').textContent = firstName + ', thank you so much! ' + (s.is_today
            ? 'Our account details are in your confirmation email' + ($('#bank') ? ' and at the bottom of this page.' : '.')
            : 'We will remind you on ' + s.payment_date + ' with our account details.');

        var dl = $('#done-summary');
        dl.innerHTML = '';
        [[gifts.length === 1 ? 'Gift' : 'Gifts', gifts.join('\n')], ['Send on', s.payment_date], ['Reference', res.reference]].forEach(function (row) {
            var dt = document.createElement('dt'); dt.textContent = row[0];
            var dd = document.createElement('dd'); dd.textContent = row[1];
            dl.appendChild(dt); dl.appendChild(dd);
        });
        $('#done-email').textContent = s.email_sent ? 'A confirmation has been sent to ' + form.email.value.trim() + '.' : '';
        setCalendar(res.calendar);
        showStep('done');
        paintBar(false);

        var theme = document.documentElement.getAttribute('data-theme');
        confetti(PALETTE[theme] || PALETTE.neutral, window.innerWidth / 2, window.innerHeight * 0.45, 160);
        vibrate([30, 40, 30]);
    }

    /* "Add to my calendar": iPhones and Macs open the .ics from the server, which shows
     * the native "Add to Calendar" prompt; Android opens Google Calendar with the event
     * filled in; other devices get a small menu to choose their calendar. */
    var calLinks = null;
    var calBtn = $('#calendar-btn');
    var calMenu = $('#calendar-menu');

    function setCalendar(links) {
        calLinks = links || null;
        calBtn.hidden = !calLinks;
        calMenu.hidden = true;
        calBtn.setAttribute('aria-expanded', 'false');
        if (!calLinks) { return; }
        $('#cal-google').href = calLinks.google;
        $('#cal-outlook').href = calLinks.outlook;
        var apple = $('#cal-apple');
        apple.hidden = !calLinks.ics;
        if (calLinks.ics) { apple.href = calLinks.ics; }
    }

    calBtn.addEventListener('click', function () {
        if (!calLinks) { return; }
        var ua = navigator.userAgent;
        var apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
        if (apple && calLinks.ics) { location.href = calLinks.ics; return; }
        if (/Android/.test(ua)) { window.open(calLinks.google, '_blank', 'noopener'); return; }
        var open = calMenu.hidden;
        calMenu.hidden = !open;
        calBtn.setAttribute('aria-expanded', String(open));
    });

    /* Start on whatever screen the address asks for. */
    route();
}());
