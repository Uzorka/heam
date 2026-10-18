<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';

$_SESSION = [];
session_destroy();
header('Location: login.php');
