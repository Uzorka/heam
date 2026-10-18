/* Baby Registry – public page behaviour:
 *   1. Gender guess + balloon pop (with confetti, sound and vibration)
 *   2. Registry list: category scroll-spy, reveal animations, hide taken
 *   3. Pledge bottom sheet
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

    function money(n) {
        var decimals = Math.floor(n) === n ? 0 : 2;
        return cfg.currency + Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }

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

    function setTheme(theme) { document.documentElement.setAttribute('data-theme', theme); }

    function store(key, value) {
        try {
            if (value === undefined) { return JSON.parse(localStorage.getItem(key) || 'null'); }
            if (value === null) { localStorage.removeItem(key); } else { localStorage.setItem(key, JSON.stringify(value)); }
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
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 6,
                w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
                r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
                color: colors[i % colors.length],
                life: 0
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
     * 1. Gender guess + balloon
     * =================================================================== */

    var intro = $('#intro');
    var stage = $('#stage');
    var result = $('#result');
    var balloon = $('#balloon');
    var hint = $('#balloon-hint');
    var guessPanel = $('#guess-panel');
    var guessForm = $('#guess-form');
    var picked = data.myGuess || null;     // 'boy' | 'girl'
    var locked = !!data.myGuess;           // guess saved on the server
    var POP_KEY = 'registry_popped';

    function canPop() { return !!picked && (locked || reveal.revealed); }

    function updateTallyMini() {
        var el = $('#tally-mini');
        if (!el) { return; }
        el.textContent = tally.total > 0
            ? tally.total + (tally.total === 1 ? ' person has' : ' people have') + ' guessed so far'
            : 'Be the first to guess!';
    }

    function guessLabel(g) { return g === 'boy' ? 'Boy 💙' : 'Girl 💗'; }

    function refreshStage() {
        intro.classList.toggle('can-pop', canPop());
        $$('.guess-btn').forEach(function (b) {
            b.classList.toggle('is-picked', b.dataset.guess === picked);
            b.disabled = locked;
        });

        if (locked) {
            guessForm.hidden = true;
            hint.textContent = reveal.revealed
                ? 'Your guess was ' + guessLabel(picked) + '. Tap the balloon to see if you were right!'
                : 'Your guess: ' + guessLabel(picked) + ' is locked in. Now tap the balloon!';
        } else if (canPop()) {
            hint.textContent = 'You picked ' + guessLabel(picked) + '. Now tap the balloon to pop it!';
        } else if (picked) {
            hint.textContent = 'Lock in your guess, then pop the balloon';
        } else {
            hint.textContent = 'Boy or girl? Make your guess, then tap the balloon';
        }
    }

    function pick(guess) {
        if (locked) { return; }
        picked = guess;
        vibrate(15);
        // Once the gender is revealed, guesses are just for fun and are not saved.
        guessForm.hidden = reveal.revealed;
        if (!reveal.revealed) {
            setTimeout(function () { guessForm.querySelector('input[name="name"]').focus({ preventScroll: true }); }, 50);
        }
        refreshStage();
    }

    $$('.guess-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { pick(btn.dataset.guess); });
    });

    if (guessForm) {
        guessForm.addEventListener('submit', function (e) {
            e.preventDefault();
            if (!picked) { return; }
            var btn = $('#guess-submit');
            var errorEl = $('#guess-error');
            errorEl.textContent = '';
            btn.classList.add('is-loading');

            var fd = new FormData(guessForm);
            fd.append('guess', picked);
            fd.append('token', data.token);

            post('api/guess.php', fd).then(function (res) {
                if (!res.ok) { errorEl.textContent = res.error || 'Please try again.'; return; }
                picked = res.guess;
                locked = true;
                tally = res.tally || tally;
                updateTallyMini();
                var msg = guessForm.message.value.trim();
                if (msg) { addWish(guessForm.name.value.trim(), msg, 'guess', picked); }
                refreshStage();
                vibrate([20, 40, 20]);
                balloon.focus({ preventScroll: true });
            }).catch(function () {
                errorEl.textContent = 'Network error – please check your connection.';
            }).then(function () { btn.classList.remove('is-loading'); });
        });
    }

    balloon.addEventListener('click', function () {
        if (!canPop()) {
            balloon.classList.remove('is-wiggling');
            void balloon.offsetWidth;
            balloon.classList.add('is-wiggling');
            guessPanel.classList.remove('is-shaking');
            void guessPanel.offsetWidth;
            guessPanel.classList.add('is-shaking');
            hint.textContent = picked ? 'Lock in your guess first 👇' : 'Make your guess first 👇';
            vibrate(30);
            return;
        }
        popBalloon();
    });

    function popBalloon() {
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
            confetti(PALETTE[reveal.revealed ? reveal.gender : 'neutral'], cx, cy, 220);
            setTimeout(function () { showResult(false); }, reducedMotion ? 0 : 750);
        }, reducedMotion ? 0 : 260);
    }

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
        setTimeout(function () { box.innerHTML = ''; }, 1200);
    }

    function showResult(instant) {
        stage.hidden = true;
        result.hidden = false;
        if (instant) { result.style.animation = 'none'; }

        var title = $('#result-title');
        var you = $('#result-you');
        var family = cfg.familyName;

        if (reveal.revealed) {
            var g = reveal.gender;
            setTheme(g);
            $('#result-kicker').textContent = 'The ' + family + ' are expecting';
            title.textContent = g === 'girl' ? "It's a girl!" : "It's a boy!";
            title.classList.remove('is-secret');
            $('#result-sub').textContent = 'Welcome, Baby ' + (g === 'girl' ? 'Girl' : 'Boy') + ' ' + family;
            if (picked) {
                you.textContent = picked === g
                    ? 'You guessed right! 🎉'
                    : 'You guessed ' + (picked === 'boy' ? 'boy' : 'girl') + '. So close! 😄';
            } else {
                you.textContent = '';
            }
            var right = tally[g] || 0;
            $('#tally-total').textContent = tally.total
                ? Math.round(right / tally.total * 100) + '% of ' + tally.total + ' guests guessed right'
                : '';
            $('#result-countdown').textContent = cfg.dueDate && daysUntil(cfg.dueDate) > 0
                ? 'Arriving in about ' + daysUntil(cfg.dueDate) + ' days'
                : '';
        } else {
            setTheme('neutral');
            $('#result-kicker').textContent = 'Your guess is in';
            title.textContent = "It's still a secret…";
            title.classList.add('is-secret');
            $('#result-sub').textContent = picked ? 'You guessed ' + guessLabel(picked) + '. Here is what everyone thinks:' : '';
            you.textContent = '';
            $('#tally-total').textContent = tally.total + (tally.total === 1 ? ' guess' : ' guesses') + ' so far';
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
            setTimeout(function () { bar.style.width = pct + '%'; }, instant ? 0 : 150);
        });

        store(POP_KEY, { guess: picked, gender: reveal.revealed ? reveal.gender : null });
    }

    $('#replay').addEventListener('click', function () {
        result.hidden = true;
        stage.hidden = false;
        balloon.classList.remove('is-popping', 'is-gone');
        setTheme('neutral');
        refreshStage();
        intro.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    });

    // Starting state: returning visitors who already popped this version of the balloon
    // see their result straight away. If the gender was revealed since, they pop again.
    (function initIntro() {
        updateTallyMini();
        var popped = store(POP_KEY);
        if (popped && popped.guess && !picked) { picked = popped.guess; }
        var sameState = popped && (reveal.revealed ? popped.gender === reveal.gender : popped.gender === null);
        if (sameState && picked) {
            balloon.classList.add('is-gone');
            showResult(true);
        } else if (popped && reveal.revealed && popped.gender === null) {
            refreshStage();
            hint.textContent = canPop()
                ? 'The secret is out! You guessed ' + guessLabel(picked) + '. Pop the balloon 🎈'
                : 'The secret is out! Make your guess, then pop the balloon 🎈';
        } else {
            refreshStage();
        }
    }());

    /* =====================================================================
     * 2. Registry list
     * =================================================================== */

    var registry = $('#reg');
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

    // Rows gently slide in as you scroll.
    if ('IntersectionObserver' in window && !reducedMotion) {
        var appear = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.remove('will-reveal');
                    appear.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -8% 0px' });
        $$('.row').forEach(function (row) {
            if (row.getBoundingClientRect().top > window.innerHeight) {
                row.classList.add('will-reveal');
                appear.observe(row);
            }
        });
    }

    var hideTaken = $('#hide-taken');
    if (hideTaken) {
        hideTaken.addEventListener('change', function () { registry.classList.toggle('hide-done', hideTaken.checked); });
    }

    var due = $('[data-due]');
    if (due) {
        var d = daysUntil(due.dataset.due);
        due.textContent = d > 1 ? '👶 Baby arrives in about ' + d + ' days' : (d >= 0 ? '👶 Baby is due any moment!' : '');
    }

    function updateTakenCount() {
        var fixed = data.items.filter(function (i) { return !i.open; });
        var taken = fixed.filter(function (i) { return i.remaining === 0; }).length;
        var count = $('#taken-count');
        var bar = $('#taken-bar');
        if (count) { count.textContent = taken; }
        if (bar) { bar.style.width = Math.round(taken / Math.max(1, fixed.length) * 100) + '%'; }
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
    function addWish(name, message, source, guess) {
        var wall = $('#wall');
        if (!wall || !message) { return; }
        var fig = document.createElement('figure');
        fig.className = 'wish';
        var q = document.createElement('blockquote');
        q.textContent = message;
        var cap = document.createElement('figcaption');
        cap.textContent = name || 'A loved one';
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = source === 'guess' ? (guess === 'boy' ? '💙 guessed boy' : '💗 guessed girl') : '🎁 sent a gift';
        cap.appendChild(document.createTextNode(' '));
        cap.appendChild(tag);
        fig.appendChild(q);
        fig.appendChild(cap);
        wall.insertBefore(fig, wall.firstChild);
        var empty = $('#wall-empty');
        if (empty) { empty.hidden = true; }
    }

    /* =====================================================================
     * 3. Pledge bottom sheet
     * =================================================================== */

    var modal = $('#pledge-modal');
    var form = $('#pledge-form');
    if (!modal || !form) { return; }

    var stepForm = $('[data-step="form"]', form);
    var stepDone = $('[data-step="done"]', form);
    var qtyInput = $('#f-quantity');
    var amountInput = $('#f-amount');
    var dateInput = $('#f-date');
    var submitBtn = $('#submit-btn');
    var formError = $('#form-error');
    var current = null;
    var lastTrigger = null;

    function choosesAmount(item) { return item.open || !(item.price > 0); }

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

    function updatePrice() {
        if (!current) { return; }
        var price = $('#modal-price');
        if (choosesAmount(current)) {
            var amt = parseFloat(amountInput.value.replace(/[, ]/g, ''));
            price.textContent = amt > 0 ? money(amt) : 'You choose the amount';
        } else {
            var q = Math.max(1, parseInt(qtyInput.value, 10) || 1);
            price.textContent = money(current.price * q) + (q > 1 ? ' (' + q + ' × ' + money(current.price) + ')' : '');
        }
    }

    /* Quick date choices: Today, Tomorrow, Friday, End of month. */
    function buildDateChips() {
        var box = $('#date-chips');
        box.innerHTML = '';
        var base = new Date(cfg.today + 'T00:00:00');
        var add = function (days) { var d = new Date(base); d.setDate(d.getDate() + days); return d; };
        var friday = add(((5 - base.getDay() + 7) % 7) || 7);
        var monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
        if (isoDate(monthEnd) <= isoDate(add(1))) { monthEnd = new Date(base.getFullYear(), base.getMonth() + 2, 0); }

        [['Today', base], ['Tomorrow', add(1)], ['This Friday', friday], ['Month end', monthEnd]].forEach(function (opt) {
            var iso = isoDate(opt[1]);
            if (iso > cfg.maxDate) { return; }
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.textContent = opt[0];
            b.dataset.date = iso;
            b.addEventListener('click', function () { dateInput.value = iso; syncDateChips(); });
            box.appendChild(b);
        });
        syncDateChips();
    }

    function syncDateChips() {
        $$('#date-chips .chip').forEach(function (c) { c.classList.toggle('is-active', c.dataset.date === dateInput.value); });
        var hintEl = $('#date-hint');
        if (!dateInput.value) { return; }
        var days = daysUntil(dateInput.value);
        hintEl.textContent = days === 0
            ? "You'll get our account details right away in your confirmation."
            : "We'll remind you with our account details on " +
              new Date(dateInput.value + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '.';
    }
    dateInput.addEventListener('change', syncDateChips);

    $$('#amount-chips .chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            amountInput.value = Number(chip.dataset.amount).toLocaleString('en-US');
            $$('#amount-chips .chip').forEach(function (c) { c.classList.toggle('is-active', c === chip); });
            updatePrice();
        });
    });
    amountInput.addEventListener('input', function () {
        $$('#amount-chips .chip').forEach(function (c) { c.classList.remove('is-active'); });
        updatePrice();
    });

    function openModal(id, trigger) {
        current = itemsById[id];
        if (!current) { return; }
        lastTrigger = trigger;

        clearErrors();
        showStep('form');
        $('#f-item').value = current.id;
        $('#modal-title').textContent = current.name;
        $('#modal-emoji').textContent = current.emoji;

        var amount = choosesAmount(current);
        $('#field-quantity').hidden = amount || !(current.remaining > 1);
        $('#field-amount').hidden = !amount;
        qtyInput.value = 1;
        qtyInput.max = current.remaining || 1;
        amountInput.value = '';
        $$('#amount-chips .chip').forEach(function (c) { c.classList.remove('is-active'); });
        if (!dateInput.value || dateInput.value < cfg.today) { dateInput.value = cfg.today; }
        buildDateChips();
        updatePrice();

        if (typeof modal.showModal === 'function') { modal.showModal(); } else { modal.setAttribute('open', ''); }
        vibrate(10);
    }

    function closeModal() {
        if (typeof modal.close === 'function') { modal.close(); } else { modal.removeAttribute('open'); }
        if (lastTrigger) { lastTrigger.focus({ preventScroll: true }); }
    }

    $$('[data-gift]').forEach(function (btn) {
        btn.addEventListener('click', function () { openModal(parseInt(btn.dataset.gift, 10), btn); });
    });
    $$('[data-close]', form).forEach(function (btn) { btn.addEventListener('click', closeModal); });
    modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); } });

    $$('[data-qty]', form).forEach(function (btn) {
        btn.addEventListener('click', function () {
            var max = parseInt(qtyInput.max, 10) || 1;
            var next = (parseInt(qtyInput.value, 10) || 1) + parseInt(btn.dataset.qty, 10);
            qtyInput.value = Math.min(max, Math.max(1, next));
            updatePrice();
        });
    });
    qtyInput.addEventListener('input', updatePrice);

    function validate() {
        var errors = {};
        var name = form.full_name.value.trim();
        if (name.length < 3 || name.indexOf(' ') === -1) { errors.full_name = 'Please enter your full name (first and last name).'; }
        if (form.phone.value.replace(/\D/g, '').length < 8) { errors.phone = 'Please enter a valid phone number.'; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim())) { errors.email = 'Please enter a valid email address.'; }
        if (!dateInput.value) { errors.payment_date = 'Please choose the day you will send it.'; }
        if (current && choosesAmount(current) && !(parseFloat(amountInput.value.replace(/[, ]/g, '')) >= 100)) {
            errors.amount = 'Please enter the amount you would like to send.';
        }
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

        submitBtn.classList.add('is-loading');
        submitBtn.textContent = 'Saving…';

        post(form.action, new FormData(form)).then(function (res) {
            if (!res.ok) {
                formError.textContent = res.error || 'Something went wrong.';
                showErrors(res.fields);
                return;
            }
            var msg = form.message.value.trim();
            if (msg && form.share_message.checked) { addWish(form.full_name.value.trim(), msg, 'pledge'); }
            showDone(res);
            updateRow(res.item);
            form.message.value = '';
        }).catch(function () {
            formError.textContent = 'Network error – please check your connection and try again.';
        }).then(function () {
            submitBtn.classList.remove('is-loading');
            submitBtn.textContent = 'Confirm my gift';
        });
    });

    function showDone(res) {
        var s = res.summary;
        var firstName = form.full_name.value.trim().split(' ')[0];
        $('#done-text').textContent = firstName + ', your gift has been noted. ' + (s.is_today
            ? 'Our account details are in your confirmation email' + ($('#bank') ? ' and at the bottom of this page.' : '.')
            : 'We will remind you on ' + s.payment_date + ' with our account details.');

        var dl = $('#done-summary');
        dl.innerHTML = '';
        [['Gift', s.gift], ['Amount', s.amount], ['Send on', s.payment_date], ['Reference', res.reference]].forEach(function (row) {
            var dt = document.createElement('dt'); dt.textContent = row[0];
            var dd = document.createElement('dd'); dd.textContent = row[1];
            dl.appendChild(dt); dl.appendChild(dd);
        });
        $('#done-email').textContent = s.email_sent ? 'A confirmation has been sent to ' + form.email.value.trim() + '.' : '';
        $('#calendar-link').href = calendarFile(s, res.reference);
        showStep('done');

        var theme = document.documentElement.getAttribute('data-theme');
        confetti(PALETTE[theme] || PALETTE.neutral, window.innerWidth / 2, window.innerHeight * 0.45, 160);
        vibrate([30, 40, 30]);
    }

    function updateRow(item) {
        if (!item || item.remaining === null) { return; }
        itemsById[item.id].remaining = item.remaining;

        var row = $('.row[data-id="' + item.id + '"]');
        if (!row) { return; }
        var total = item.remaining + item.pledged;
        var bar = $('.mini-bar span', row);
        if (bar) { bar.style.width = Math.round(item.pledged / Math.max(1, total) * 100) + '%'; }
        var stock = $('[data-stock-text]', row);

        if (item.remaining <= 0) {
            row.classList.add('is-done');
            var btn = $('[data-gift]', row);
            btn.disabled = true;
            btn.textContent = 'Taken ✓';
            if (stock) { stock.textContent = 'All taken'; }
        } else if (stock) {
            stock.textContent = item.remaining + ' of ' + total + ' still needed';
        }
        row.classList.remove('is-flash');
        void row.offsetWidth;
        row.classList.add('is-flash');
        updateTakenCount();
    }

    /* A small .ics calendar file so guests can add the payment day to their phone. */
    function calendarFile(s, ref) {
        var d = s.date_iso.replace(/-/g, '');
        var next = new Date(s.date_iso + 'T00:00:00');
        next.setDate(next.getDate() + 1);
        var esc = function (t) { return String(t).replace(/([,;\\])/g, '\\$1'); };
        var ics = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Baby Registry//EN', 'BEGIN:VEVENT',
            'UID:' + ref + '@baby-registry',
            'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
            'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + isoDate(next).replace(/-/g, ''),
            'SUMMARY:' + esc('Gift for ' + cfg.babyName + ': ' + s.gift + ' (' + s.amount + ')'),
            'DESCRIPTION:' + esc('Reference ' + ref + '. Account details are in your reminder email.'),
            'BEGIN:VALARM', 'TRIGGER:PT9H', 'ACTION:DISPLAY', 'DESCRIPTION:Gift reminder', 'END:VALARM',
            'END:VEVENT', 'END:VCALENDAR'
        ].join('\r\n');
        return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    }
}());
