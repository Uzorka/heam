<?php
/**
 * Work and service experience.
 *
 * Every key except 'organization' is optional; anything left out is simply not displayed.
 *   'role'             => 'Job title',
 *   'parent'           => 'Wider organisation the workplace belongs to',
 *   'location'         => 'Town, State',
 *   'duration'         => 'Three years',
 *   'period'           => '2019 – 2024',
 *   'summary'          => 'One or two sentences about the role.',
 *   'responsibilities' => ['Responsibility or achievement', ...],
 *   'worked_with'      => ['Name', ...] or [['name' => 'Name', 'role' => 'Their title'], ...],
 */

return [
    [
        'organization'     => 'Jabin Olori Motel',
        'role'             => 'Receptionist / Supervisor',
        'location'         => 'Ughelli, Delta State',
        'duration'         => 'Seven years',
        'responsibilities' => [
            'CCTV installation',
        ],
    ],
    [
        'organization' => 'Holy Spirit Catholic Church',
        'role'         => 'Accountant',
        'parent'       => 'Catholic Diocese of Warri · Served by the Redemptorist Fathers and Brothers',
        'location'     => 'P.O. Box 812, Ighwrekpokpor, Ughelli, Delta State',
        'duration'     => 'Three years',
        'worked_with'  => [
            ['name' => 'Rev. Fr. Bem Ignatious Gede, C.Ss.R.', 'role' => 'Parish Priest'],
            ['name' => 'Rev. Fr. Paschal Ahanonu, C.Ss.R.'],
            ['name' => 'Rev. Fr. James Vembe, C.Ss.R.'],
        ],
    ],
];
