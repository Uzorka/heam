<?php
/**
 * Gift items: list, show/hide and delete.
 */

declare(strict_types=1);

require dirname(__DIR__) . '/includes/admin.php';
require_admin();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_post_csrf();
    $id = (int) ($_POST['id'] ?? 0);

    switch ($_POST['action'] ?? '') {
        case 'toggle':
            db()->prepare('UPDATE items SET is_active = 1 - is_active WHERE id = ?')->execute([$id]);
            flash('success', 'Item updated.');
            break;

        case 'delete':
            $count = db()->prepare('SELECT COUNT(*) FROM pledges WHERE item_id = ?');
            $count->execute([$id]);
            if ((int) $count->fetchColumn() > 0) {
                flash('error', 'This item has pledges, so it cannot be deleted. Hide it instead.');
            } else {
                db()->prepare('DELETE FROM items WHERE id = ?')->execute([$id]);
                flash('info', 'Item deleted.');
            }
            break;
    }
    redirect('items.php');
}

$items = fetch_items(true);
$token = csrf_token();

admin_header('Gift items', 'items.php');
?>
<div class="toolbar">
    <h1>Gift items</h1>
    <a class="btn" href="item-edit.php">+ Add item</a>
</div>

<div class="table-wrap">
<table class="table">
    <thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Pledged</th><th>Shown</th><th class="right">Actions</th></tr></thead>
    <tbody>
    <?php foreach ($items as $item): ?>
        <tr class="<?= $item['is_active'] ? '' : 'is-muted' ?>">
            <td data-label="Item">
                <a class="strong" href="item-edit.php?id=<?= $item['id'] ?>"><?= e($item['emoji'] . ' ' . $item['name']) ?></a>
            </td>
            <td data-label="Category"><?= e($item['category']) ?></td>
            <td data-label="Price" class="nowrap"><?= $item['is_open_amount'] ? 'Any amount' : ($item['price'] > 0 ? e(money($item['price'])) : 'Guest chooses') ?></td>
            <td data-label="Pledged">
                <?= $item['is_open_amount']
                    ? e($item['pledged_qty'] . ' gifts · ' . money((float) $item['pledged_amount']))
                    : e($item['pledged_qty'] . ' / ' . $item['quantity_needed']) ?>
            </td>
            <td data-label="Shown"><?= $item['is_active'] ? 'Yes' : 'Hidden' ?></td>
            <td class="actions">
                <form method="post">
                    <input type="hidden" name="token" value="<?= e($token) ?>">
                    <input type="hidden" name="id" value="<?= $item['id'] ?>">
                    <a class="btn btn-sm btn-ghost" href="item-edit.php?id=<?= $item['id'] ?>">Edit</a>
                    <button class="btn btn-sm btn-ghost" name="action" value="toggle"><?= $item['is_active'] ? 'Hide' : 'Show' ?></button>
                    <button class="btn btn-sm btn-danger" name="action" value="delete" data-confirm="Delete this item?">Delete</button>
                </form>
            </td>
        </tr>
    <?php endforeach; ?>
    </tbody>
</table>
</div>

<?php admin_footer(); ?>
