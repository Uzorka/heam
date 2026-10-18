/* Baby Registry – public page behaviour: countdown, filters, pledge form. */
(function () {
    'use strict';

    var data = window.REGISTRY || { items: [], config: {} };
    var cfg = data.config;
    var itemsById = {};
    data.items.forEach(function (item) { itemsById[item.id] = item; });

    function money(n) {
        var decimals = Math.floor(n) === n ? 0 : 2;
        return cfg.currency + Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }

    /* ---- Countdown ------------------------------------------------------ */

    var countdown = document.getElementById('countdown');
    if (countdown) {
        var target = new Date(countdown.dataset.date + 'T00:00:00');
        var tick = function () {
            var diff = target - new Date();
            if (diff <= 0) {
                countdown.classList.add('is-born');
                countdown.textContent = '🎉 ' + cfg.babyName + ' is here (or very nearly)!';
                return false;
            }
            var mins = Math.floor(diff / 60000);
            countdown.querySelector('[data-unit="days"]').textContent = Math.floor(mins / 1440);
            countdown.querySelector('[data-unit="hours"]').textContent = Math.floor(mins / 60) % 24;
            countdown.querySelector('[data-unit="minutes"]').textContent = mins % 60;
            return true;
        };
        if (tick()) { setInterval(tick, 30000); }
    }

    /* ---- Filters -------------------------------------------------------- */

    var activeFilter = 'all';
    var hideGifted = document.getElementById('hide-gifted');

    function applyFilters() {
        document.querySelectorAll('#items .card').forEach(function (card) {
            var show = (activeFilter === 'all' || card.dataset.category === activeFilter)
                && !(hideGifted && hideGifted.checked && card.classList.contains('is-done'));
            card.hidden = !show;
        });
    }

    document.querySelectorAll('.chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('is-active'); });
            chip.classList.add('is-active');
            activeFilter = chip.dataset.filter;
            applyFilters();
        });
    });
    if (hideGifted) { hideGifted.addEventListener('change', applyFilters); }

    /* ---- Copy account number ------------------------------------------- */

    function toast(text) {
        var el = document.createElement('div');
        el.className = 'toast';
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 2000);
    }

    document.querySelectorAll('[data-copy]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var done = function () {
                btn.classList.add('is-copied');
                btn.textContent = 'Copied';
                setTimeout(function () { btn.classList.remove('is-copied'); btn.textContent = 'Copy'; }, 1800);
            };
            if (navigator.clipboard) {
                navigator.clipboard.writeText(btn.dataset.copy).then(done, function () { toast(btn.dataset.copy); });
            } else {
                toast(btn.dataset.copy);
            }
        });
    });

    /* ---- Pledge modal --------------------------------------------------- */

    var modal = document.getElementById('pledge-modal');
    var form = document.getElementById('pledge-form');
    if (!modal || !form) { return; }

    var steps = {
        form: form.querySelector('[data-step="form"]'),
        done: form.querySelector('[data-step="done"]')
    };
    var qtyInput = document.getElementById('f-quantity');
    var amountInput = document.getElementById('f-amount');
    var submitBtn = document.getElementById('submit-btn');
    var formError = document.getElementById('form-error');
    var current = null;

    function showStep(name) {
        steps.form.hidden = name !== 'form';
        steps.done.hidden = name !== 'done';
    }

    function clearErrors() {
        formError.textContent = '';
        form.querySelectorAll('.field').forEach(function (f) { f.classList.remove('has-error'); });
        form.querySelectorAll('[data-error]').forEach(function (p) { p.textContent = ''; });
    }

    function showErrors(fields) {
        Object.keys(fields || {}).forEach(function (name) {
            var p = form.querySelector('[data-error="' + name + '"]');
            if (p) {
                p.textContent = fields[name];
                p.closest('.field').classList.add('has-error');
            }
        });
        var first = form.querySelector('.has-error input, .has-error textarea');
        if (first) { first.focus(); }
    }

    function updatePrice() {
        if (!current) { return; }
        var price = document.getElementById('modal-price');
        if (current.open) {
            price.textContent = 'Any amount you choose';
        } else {
            var q = Math.max(1, parseInt(qtyInput.value, 10) || 1);
            price.textContent = money(current.price * q) + (q > 1 ? ' (' + q + ' × ' + money(current.price) + ')' : '');
        }
    }

    function openModal(id) {
        current = itemsById[id];
        if (!current) { return; }

        clearErrors();
        showStep('form');
        document.getElementById('f-item').value = current.id;
        document.getElementById('modal-title').textContent = current.name;
        document.getElementById('modal-emoji').textContent = current.emoji;

        var hasQty = !current.open && current.remaining > 1;
        document.getElementById('field-quantity').hidden = !hasQty;
        document.getElementById('field-amount').hidden = !current.open;
        qtyInput.value = 1;
        qtyInput.max = current.remaining || 1;
        amountInput.value = '';
        updatePrice();

        if (typeof modal.showModal === 'function') { modal.showModal(); } else { modal.setAttribute('open', ''); }
        setTimeout(function () { (current.open ? amountInput : document.getElementById('f-name')).focus(); }, 50);
    }

    function closeModal() {
        if (typeof modal.close === 'function') { modal.close(); } else { modal.removeAttribute('open'); }
    }

    document.querySelectorAll('[data-gift]').forEach(function (btn) {
        btn.addEventListener('click', function () { openModal(parseInt(btn.dataset.gift, 10)); });
    });
    form.querySelectorAll('[data-close]').forEach(function (btn) { btn.addEventListener('click', closeModal); });
    modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); } });

    form.querySelectorAll('[data-qty]').forEach(function (btn) {
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
        if (!form.payment_date.value) { errors.payment_date = 'Please choose the date you would like to pay.'; }
        if (current && current.open && !(parseFloat(amountInput.value.replace(/[, ]/g, '')) >= 100)) {
            errors.amount = 'Please enter the amount you would like to give.';
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
            return;
        }

        submitBtn.classList.add('is-loading');
        submitBtn.textContent = 'Saving…';

        fetch(form.action, { method: 'POST', body: new FormData(form), credentials: 'same-origin' })
            .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Unexpected server response.' }; }); })
            .then(function (res) {
                if (!res.ok) {
                    formError.textContent = res.error || 'Something went wrong.';
                    showErrors(res.fields);
                    return;
                }
                showDone(res);
                updateCard(res.item);
                form.message.value = '';
            })
            .catch(function () { formError.textContent = 'Network error – please check your connection and try again.'; })
            .then(function () {
                submitBtn.classList.remove('is-loading');
                submitBtn.textContent = 'Confirm my gift';
            });
    });

    function showDone(res) {
        var s = res.summary;
        var firstName = form.full_name.value.trim().split(' ')[0];
        document.getElementById('done-text').textContent =
            firstName + ', your gift has been noted. ' + (s.is_today
                ? 'Our account details are in your confirmation email' + (document.getElementById('bank') ? ' and below on this page.' : '.')
                : 'We will remind you on ' + s.payment_date + ' with our account details.');

        var dl = document.getElementById('done-summary');
        dl.innerHTML = '';
        [['Gift', s.gift], ['Amount', s.amount], ['Payment date', s.payment_date], ['Reference', res.reference]].forEach(function (row) {
            var dt = document.createElement('dt'); dt.textContent = row[0];
            var dd = document.createElement('dd'); dd.textContent = row[1];
            dl.appendChild(dt); dl.appendChild(dd);
        });
        document.getElementById('done-email').textContent = s.email_sent
            ? 'A confirmation has been sent to ' + form.email.value.trim() + '.'
            : '';

        document.getElementById('calendar-link').href = calendarFile(s, res.reference);
        showStep('done');
    }

    function updateCard(item) {
        if (!item || item.remaining === null) { return; }
        var stored = itemsById[item.id];
        stored.remaining = item.remaining;

        var card = document.querySelector('.card[data-id="' + item.id + '"]');
        if (!card) { return; }
        var total = item.remaining + item.pledged;
        var bar = card.querySelector('.progress span');
        if (bar) { bar.style.width = Math.round(item.pledged / Math.max(1, total) * 100) + '%'; }
        var stock = card.querySelector('[data-stock]');

        if (item.remaining <= 0) {
            card.classList.add('is-done');
            var btn = card.querySelector('[data-gift]');
            btn.disabled = true;
            btn.textContent = 'Gifted';
            if (stock) { stock.textContent = 'Fully gifted – thank you!'; }
        } else if (stock) {
            stock.textContent = total > 1 ? item.remaining + ' of ' + total + ' still needed' : 'Still needed';
        }
        applyFilters();
    }

    /* A small .ics calendar file so guests can add the payment date to their phone. */
    function calendarFile(s, ref) {
        var d = s.date_iso.replace(/-/g, '');
        var next = new Date(s.date_iso + 'T00:00:00');
        next.setDate(next.getDate() + 1);
        var end = next.getFullYear() + String(next.getMonth() + 1).padStart(2, '0') + String(next.getDate()).padStart(2, '0');
        var esc = function (t) { return String(t).replace(/([,;\\])/g, '\\$1'); };
        var ics = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Baby Registry//EN', 'BEGIN:VEVENT',
            'UID:' + ref + '@baby-registry',
            'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
            'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + end,
            'SUMMARY:' + esc('Gift for ' + cfg.babyName + ': ' + s.gift + ' (' + s.amount + ')'),
            'DESCRIPTION:' + esc('Reference ' + ref + '. Account details are in your reminder email.'),
            'BEGIN:VALARM', 'TRIGGER:PT9H', 'ACTION:DISPLAY', 'DESCRIPTION:Gift reminder', 'END:VALARM',
            'END:VEVENT', 'END:VCALENDAR'
        ].join('\r\n');
        return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    }
}());
