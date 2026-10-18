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
}());
