<?php
/**
 * Loads configuration and shared helpers. Included at the top of every page.
 */

declare(strict_types=1);

$config = require __DIR__ . '/config.php';
require_once __DIR__ . '/functions.php';

header_remove('X-Powered-By');
start_secure_session();
