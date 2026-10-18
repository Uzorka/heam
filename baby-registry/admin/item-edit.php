<?php
/**
 * Add or edit a gift item, including an optional photo upload.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';
require_admin();

$id   = (int) ($_GET['id'] ?? 0);
$item = $id ? fetch_item($id) : null;
if ($id && !$item) {
    flash('error', 'Item not found.');
    redirect('items.php');
}

$values = $item ?? [
    'name' => '', 'description' => '', 'category' => '', 'price' => 0, 'quantity_needed' => 1,
    'is_open_amount' => false, 'image' => '', 'emoji' => '🎁', 'sort_order' => 0, 'is_active' => 1,
];
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_post_csrf();

    $values = [
        'name'            => trim((string) ($_POST['name'] ?? '')),
        'description'     => trim((string) ($_POST['description'] ?? '')),
        'category'        => trim((string) ($_POST['category'] ?? '')) ?: 'Other',
        'price'           => (float) str_replace([',', ' '], '', (string) ($_POST['price'] ?? '0')),
        'quantity_needed' => max(1, (int) ($_POST['quantity_needed'] ?? 1)),
        'is_open_amount'  => !empty($_POST['is_open_amount']),
        'image'           => trim((string) ($_POST['image_url'] ?? '')),
        'emoji'           => mb_substr(trim((string) ($_POST['emoji'] ?? '')) ?: '🎁', 0, 8),
        'sort_order'      => (int) ($_POST['sort_order'] ?? 0),
        'is_active'       => !empty($_POST['is_active']) ? 1 : 0,
    ];

    if ($values['name'] === '' || mb_strlen($values['name']) > 150) {
        $errors[] = 'Please enter a name (up to 150 characters).';
    }
    if ($values['price'] < 0) {
        $errors[] = 'The price cannot be negative.';
    }
    // Keep an uploaded photo unless a link is entered instead.
    $oldImage = $item['image'] ?? '';
    if ($values['image'] === '' && str_starts_with($oldImage, 'uploads/')) {
        $values['image'] = $oldImage;
    } elseif ($values['image'] !== '' && !preg_match('#^https?://#i', $values['image'])) {
        $errors[] = 'The image link must start with https://';
    }
    if (!empty($_POST['remove_image'])) {
        $values['image'] = '';
    }

    // Optional photo upload (JPG, PNG, WEBP or GIF, max 3 MB).
    $file = $_FILES['image_file'] ?? null;
    if ($file && $file['error'] !== UPLOAD_ERR_NO_FILE) {
        $types = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
        $info  = $file['error'] === UPLOAD_ERR_OK ? @getimagesize($file['tmp_name']) : false;
        if (!$info || !isset($types[$info['mime']])) {
            $errors[] = 'The photo must be a JPG, PNG, WEBP or GIF image.';
        } elseif ($file['size'] > 3 * 1024 * 1024) {
            $errors[] = 'The photo is too large (3 MB max).';
        } else {
            $name = 'uploads/' . bin2hex(random_bytes(8)) . '.' . $types[$info['mime']];
            if (move_uploaded_file($file['tmp_name'], REGISTRY_ROOT . '/' . $name)) {
                $values['image'] = $name;
            } else {
                $errors[] = 'Could not save the photo. Check that the uploads folder is writable.';
            }
        }
    }

    if (!$errors) {
        $data = [
            $values['name'], $values['description'], $values['category'],
            $values['is_open_amount'] ? 0 : $values['price'],
            $values['is_open_amount'] ? 1 : $values['quantity_needed'],
            $values['is_open_amount'] ? 1 : 0,
            $values['image'], $values['emoji'], $values['sort_order'], $values['is_active'],
        ];
        if ($item) {
            $data[] = $id;
            db()->prepare(
                'UPDATE items SET name = ?, description = ?, category = ?, price = ?, quantity_needed = ?, is_open_amount = ?,
                 image = ?, emoji = ?, sort_order = ?, is_active = ? WHERE id = ?'
            )->execute($data);
        } else {
            db()->prepare(
                'INSERT INTO items (name, description, category, price, quantity_needed, is_open_amount, image, emoji, sort_order, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute($data);
        }

        // Remove a previously uploaded photo that is no longer used.
        if ($oldImage !== $values['image'] && str_starts_with($oldImage, 'uploads/')) {
            @unlink(REGISTRY_ROOT . '/uploads/' . basename($oldImage));
        }

        flash('success', $item ? 'Item saved.' : 'Item added.');
        redirect('items.php');
    }
}

$categories = db()->query('SELECT DISTINCT category FROM items ORDER BY category')->fetchAll(PDO::FETCH_COLUMN);
$preview = item_image($values, '../');

admin_header($item ? 'Edit item' : 'Add item', 'items.php');
?>
<p class="crumb"><a href="items.php">← All items</a></p>

<?php foreach ($errors as $error): ?><p class="flash flash-error"><?= e($error) ?></p><?php endforeach; ?>

<form method="post" enctype="multipart/form-data" class="card form form-grid">
    <input type="hidden" name="token" value="<?= e(csrf_token()) ?>">

    <label class="span-2">Name <input type="text" name="name" value="<?= e($values['name']) ?>" required maxlength="150"></label>
    <label class="span-2">Short description <input type="text" name="description" value="<?= e($values['description']) ?>" maxlength="500"></label>

    <label>Category
        <input type="text" name="category" value="<?= e($values['category']) ?>" list="categories" placeholder="e.g. Nursery">
        <datalist id="categories"><?php foreach ($categories as $c): ?><option value="<?= e($c) ?>"><?php endforeach; ?></datalist>
    </label>
    <label>Emoji (shown when there is no photo) <input type="text" name="emoji" value="<?= e($values['emoji']) ?>" maxlength="8"></label>

    <label class="check span-2"><input type="checkbox" name="is_open_amount" value="1" id="open-amount" <?= $values['is_open_amount'] ? 'checked' : '' ?>>
        Cash gift (any number of guests can pick it; it is never greyed out)</label>

    <label data-fixed>Estimated value (<?= e(registry_config()['site']['currency']) ?>) <input type="text" name="price" inputmode="decimal" value="<?= e($values['price'] ?: '') ?>">
        <small class="muted">Private, for your own records. Guests never see it. Can be left empty.</small></label>
    <label data-fixed>How many people can pick it? <input type="number" name="quantity_needed" min="1" value="<?= (int) $values['quantity_needed'] ?>">
        <small class="muted">Usually 1. When that many have picked it, it is greyed out on the registry.</small></label>

    <label>Upload photo <input type="file" name="image_file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
    <label>…or photo link <input type="url" name="image_url" value="<?= e(str_starts_with($values['image'], 'uploads/') ? '' : $values['image']) ?>" placeholder="https://…"></label>
    <?php if ($preview): ?>
        <div class="span-2 preview">
            <img src="<?= e($preview) ?>" alt="">
            <label class="check"><input type="checkbox" name="remove_image" value="1"> Remove photo</label>
        </div>
    <?php endif; ?>

    <label>Display order (lower first) <input type="number" name="sort_order" value="<?= (int) $values['sort_order'] ?>"></label>
    <label class="check"><input type="checkbox" name="is_active" value="1" <?= $values['is_active'] ? 'checked' : '' ?>> Show on registry</label>

    <div class="span-2"><button class="btn" type="submit">Save item</button></div>
</form>

<?php admin_footer(); ?>
