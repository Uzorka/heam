/* Registry admin: confirmation prompts and the item form toggle. */
(function () {
    'use strict';

    // Ask before destructive or message-sending actions.
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-confirm]');
        if (btn && !window.confirm(btn.dataset.confirm)) {
            e.preventDefault();
        }
    });

    // Prevent double submits (e.g. sending the thank-you twice).
    document.querySelectorAll('form').forEach(function (form) {
        form.addEventListener('submit', function (e) {
            if (form.dataset.sending) { e.preventDefault(); return; }
            form.dataset.sending = '1';
            setTimeout(function () { delete form.dataset.sending; }, 4000);
        });
    });

    // Item editor: hide price/quantity for "any amount" funds.
    var open = document.getElementById('open-amount');
    if (open) {
        var sync = function () {
            document.querySelectorAll('[data-fixed]').forEach(function (el) { el.hidden = open.checked; });
        };
        open.addEventListener('change', sync);
        sync();
    }

    // Phones: the sidebar slides in from the left.
    var menuBtn = document.getElementById('menu-btn');
    var scrim = document.getElementById('side-scrim');
    if (menuBtn && scrim) {
        var setMenu = function (open) {
            document.body.classList.toggle('menu-open', open);
            menuBtn.setAttribute('aria-expanded', String(open));
            scrim.hidden = !open;
        };
        menuBtn.addEventListener('click', function () { setMenu(!document.body.classList.contains('menu-open')); });
        scrim.addEventListener('click', function () { setMenu(false); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setMenu(false); } });
    }
}());
