<?php
/**
 * The messages guests receive and the logic that sends them.
 *
 *   confirmation – right after a guest picks a gift
 *   reminder     – on the payment date they chose (cron/send-reminders.php)
 *   followup     – a few days later if still unpaid (optional)
 *   thankyou     – when the admin marks the gift as paid
 *
 * Edit the wording in pledge_message() below.
 */

declare(strict_types=1);

const NOTIFICATION_COLUMNS = [
    'confirmation' => 'confirmation_sent_at',
    'reminder'     => 'reminder_sent_at',
    'followup'     => 'followup_sent_at',
    'thankyou'     => 'thankyou_sent_at',
];

/**
 * Builds the subject, plain text, HTML and WhatsApp parameters for a message.
 */
function pledge_message(array $pledge, string $type): array
{
    $site    = registry_config()['site'];
    $first   = trim(explode(' ', trim($pledge['full_name']))[0]);
    $sum     = pledge_summary($pledge);
    $date    = nice_date($pledge['payment_date']);
    $ref     = $pledge['reference'];
    $bank    = bank_details_text();
    $baby    = $site['baby_name'];
    $parents = $site['parents'];
    $link    = registry_url() . '/';

    switch ($type) {
        case 'confirmation':
            $subject = "Thank you for your gift pledge for {$baby} 💛";
            $text = "Hi {$first},\n\n"
                  . "Thank you so much for choosing to bless {$baby}! Here is what you picked:\n\n"
                  . "Gift: {$sum['label']}\nAmount: {$sum['amount']}\nPayment date: {$date}\nReference: {$ref}\n\n"
                  . ($pledge['payment_date'] <= date('Y-m-d')
                      ? "Here are our account details for today:\n\n{$bank}\n\n"
                      : "We will send you a reminder with our account details on {$date}. "
                      . "If you would like to send it earlier, here are the details:\n\n{$bank}\n\n")
                  . "Please use {$ref} as the transfer description so we can match your gift.\n\n"
                  . "With love,\n{$parents}";
            $params = [$first, $sum['label'], $sum['amount'], $date, bank_details_inline(), $ref];
            break;

        case 'reminder':
        case 'followup':
            $subject = $type === 'reminder'
                ? "Reminder: your gift for {$baby} is due today"
                : "Gentle reminder: your gift for {$baby}";
            $intro = $type === 'reminder'
                ? "Today is the day you chose to send your gift for {$baby}. Thank you for remembering us!"
                : "Just a gentle reminder about the gift you kindly pledged for {$baby} on {$date}. "
                . "If you have already sent it, thank you – please ignore this message.";
            $text = "Hi {$first},\n\n{$intro}\n\n"
                  . "Gift: {$sum['label']}\nAmount: {$sum['amount']}\nReference: {$ref}\n\n"
                  . "Please send it to:\n\n{$bank}\n\n"
                  . "Use {$ref} as the transfer description so we can match your gift.\n\n"
                  . "With love and gratitude,\n{$parents}";
            $params = [$first, $sum['label'], $sum['amount'], bank_details_inline(), $ref];
            break;

        case 'thankyou':
            $subject = "We received your gift – thank you! 💛";
            $text = "Hi {$first},\n\n"
                  . "We have received your gift ({$sum['label']}) for {$baby}. "
                  . "Thank you so much for your love, kindness and support – it means more than words can say.\n\n"
                  . "With love and gratitude,\n{$parents}";
            $params = [$first, $sum['label'], $parents];
            break;

        default:
            throw new InvalidArgumentException("Unknown message type {$type}");
    }

    return [
        'subject' => $subject,
        'text'    => $text,
        'html'    => email_html($subject, $text, $type !== 'thankyou', $link),
        'params'  => $params,
    ];
}

/** Turns the plain text message into a simple, friendly HTML email. */
function email_html(string $title, string $text, bool $highlightBank, string $link): string
{
    $site = registry_config()['site'];
    $blocks = preg_split("/\n{2,}/", trim($text));
    $bank = bank_details_text();
    $html = '';

    foreach ($blocks as $block) {
        if ($highlightBank && $block === $bank) {
            $html .= '<div style="background:#fff7ec;border:1px solid #f1d9b5;border-radius:12px;padding:16px 18px;margin:0 0 16px;'
                   . 'font-family:Consolas,Menlo,monospace;font-size:15px;line-height:1.7;color:#3d3027">'
                   . nl2br(e($block)) . '</div>';
            continue;
        }
        $html .= '<p style="margin:0 0 16px;line-height:1.6">' . nl2br(e($block)) . '</p>';
    }

    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
         . '<title>' . e($title) . '</title></head>'
         . '<body style="margin:0;background:#f6f1ea;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#3d3027;font-size:16px">'
         . '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(61,48,39,.08)">'
         . '<div style="background:#e9dccb;padding:28px 24px;text-align:center">'
         . '<div style="font-size:34px;line-height:1">👶</div>'
         . '<div style="font-family:Georgia,serif;font-size:24px;margin-top:8px;color:#3d3027">' . e($site['baby_name']) . '</div>'
         . '</div>'
         . '<div style="padding:28px 24px 12px">' . $html . '</div>'
         . '<div style="padding:0 24px 28px;text-align:center">'
         . '<a href="' . e($link) . '" style="display:inline-block;background:#7d9a7e;color:#ffffff;text-decoration:none;'
         . 'padding:12px 22px;border-radius:999px;font-weight:bold">View the registry</a></div>'
         . '</div></body></html>';
}

/**
 * Sends one message type to a guest by email and (if chosen) WhatsApp.
 *
 * The matching *_sent_at column is set when at least one channel worked,
 * or when no channel could be used at all (so cron does not retry forever).
 *
 * @return array<string, array{0: bool, 1: string}> Results per channel.
 */
function notify_pledge(array $pledge, string $type): array
{
    $msg = pledge_message($pledge, $type);
    $results = [];
    $id = (int) $pledge['id'];

    if ($pledge['email'] !== '') {
        $results['email'] = send_email($pledge['email'], $pledge['full_name'], $msg['subject'], $msg['html'], $msg['text']);
        log_notification($id, 'email', $type, $pledge['email'], ...$results['email']);
    }

    if ($pledge['notify_via'] === 'both' && whatsapp_enabled()) {
        $results['whatsapp'] = send_whatsapp($pledge['phone'], $type, $msg['params'], $msg['text']);
        log_notification($id, 'whatsapp', $type, display_phone($pledge['phone']), ...$results['whatsapp']);
    }

    $anySuccess = $results === [] || in_array(true, array_column($results, 0), true);
    if ($anySuccess && isset(NOTIFICATION_COLUMNS[$type])) {
        db()->prepare('UPDATE pledges SET ' . NOTIFICATION_COLUMNS[$type] . ' = NOW() WHERE id = ?')->execute([$id]);
    }

    return $results;
}

/** Lets the admin know someone has picked a gift. */
function notify_admin_new_pledge(array $pledge): void
{
    $to = registry_config()['admin']['notify_email'] ?? '';
    if ($to === '') {
        return;
    }

    $sum  = pledge_summary($pledge);
    $text = "New gift pledge on the registry.\n\n"
          . "Name: {$pledge['full_name']}\nPhone: " . display_phone($pledge['phone']) . "\nEmail: {$pledge['email']}\n"
          . "Gift: {$sum['label']}\nAmount: {$sum['amount']}\nPayment date: " . nice_date($pledge['payment_date']) . "\n"
          . "Reference: {$pledge['reference']}"
          . ($pledge['message'] !== '' ? "\n\nMessage:\n{$pledge['message']}" : '');

    $subject = "New pledge: {$sum['label']} from {$pledge['full_name']}";
    $result  = send_email($to, '', $subject, email_html($subject, $text, false, registry_url() . '/admin/'), $text);
    log_notification((int) $pledge['id'], 'email', 'admin', $to, ...$result);
}
