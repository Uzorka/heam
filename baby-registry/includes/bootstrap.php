<?php
/**
 * Loaded by every page: settings, helpers, database, mail and WhatsApp.
 */

declare(strict_types=1);

define('REGISTRY_ROOT', dirname(__DIR__));

$config = require __DIR__ . '/config.php';
date_default_timezone_set($config['site']['timezone'] ?: 'UTC');

require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/whatsapp.php';
require_once __DIR__ . '/notifications.php';

registry_config($config);
