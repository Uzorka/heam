<svg viewBox="0 0 200 300" aria-hidden="true" focusable="false">
    <defs>
        <radialGradient id="bfill-<?= $balloonId = ($balloonId ?? 0) + 1 ?>" cx="38%" cy="32%" r="70%">
            <stop offset="0" stop-color="var(--balloon-hi)" />
            <stop offset="1" stop-color="var(--balloon-lo)" />
        </radialGradient>
    </defs>
    <ellipse class="b-body" cx="100" cy="105" rx="78" ry="96" fill="url(#bfill-<?= $balloonId ?>)" />
    <path class="b-shine" d="M58 62 Q70 38 96 32" />
    <path class="b-knot" d="M92 200 L108 200 L100 212 Z" />
    <text class="b-mark" x="100" y="128" text-anchor="middle">?</text>
    <path class="b-string" d="M100 212 C 88 235, 114 255, 98 296" />
</svg>
