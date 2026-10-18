<?php
/**
 * Admin login. While no password hash is set in config.php, this page
 * instead helps create one.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';

$admin   = registry_config()['admin'];
$hasHash = $admin['password_hash'] !== '';
$error   = '';
$newHash = '';

if (admin_logged_in()) {
    redirect('index.php');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_valid($_POST['token'] ?? null)) {
        $error = 'Your session expired. Please try again.';
    } elseif (!$hasHash) {
        $pw = (string) ($_POST['new_password'] ?? '');
        if (mb_strlen($pw) < 10) {
            $error = 'Please use at least 10 characters.';
        } else {
            $newHash = password_hash($pw, PASSWORD_DEFAULT);
        }
    } else {
        // Slow down repeated guessing.
        $_SESSION['login_attempts'] = ($_SESSION['login_attempts'] ?? 0) + 1;
        if ($_SESSION['login_attempts'] > 5) {
            sleep(min(10, $_SESSION['login_attempts'] - 5));
        }

        $user = (string) ($_POST['username'] ?? '');
        $pass = (string) ($_POST['password'] ?? '');
        if (hash_equals($admin['username'], $user) && password_verify($pass, $admin['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['admin_user'] = $user;
            $_SESSION['admin_hash'] = substr(hash('sha256', $admin['password_hash']), 0, 16);
            $_SESSION['login_attempts'] = 0;
            redirect('index.php');
        }
        $error = 'Wrong username or password.';
    }
}

admin_header('Log in');
?>
<div class="login">
    <h1>👶 Registry admin</h1>

    <?php if ($error): ?><p class="flash flash-error"><?= e($error) ?></p><?php endif; ?>

    <?php if ($newHash): ?>
        <div class="card">
            <h2>Almost done</h2>
            <p>Open <code>includes/config.php</code> and paste this as the <code>password_hash</code> value
               (between the quotes), save, then reload this page:</p>
            <textarea class="code" rows="3" readonly onclick="this.select()"><?= e($newHash) ?></textarea>
        </div>
    <?php elseif (!$hasHash): ?>
        <form method="post" class="card">
            <h2>Set your admin password</h2>
            <p class="muted">No admin password is set yet. Choose one below and this page will show you a line to paste
               into <code>includes/config.php</code>. Nothing is saved until you do that.</p>
            <input type="hidden" name="token" value="<?= e(csrf_token()) ?>">
            <label>New password <input type="password" name="new_password" minlength="10" required autocomplete="new-password"></label>
            <button class="btn" type="submit">Create password hash</button>
        </form>
    <?php else: ?>
        <form method="post" class="card">
            <input type="hidden" name="token" value="<?= e(csrf_token()) ?>">
            <label>Username <input type="text" name="username" required autocomplete="username" autofocus></label>
            <label>Password <input type="password" name="password" required autocomplete="current-password"></label>
            <button class="btn" type="submit">Log in</button>
        </form>
    <?php endif; ?>
</div>
<?php admin_footer(); ?>
